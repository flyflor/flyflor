import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigService } from "../../src/config/config.service";
import { ContextBuilderService } from "../../src/context";
import { AgentRuntimeService } from "../../src/kernel";
import { MemoryComponent } from "../../src/memory";
import { SignalBus } from "../../src/signal";
import { SocketServerService, type SocketEnvelope } from "../../src/socket";

/**
 * Describes an isolated scenario profile.
 *
 * @property root - Repository root used by ConfigService.
 * @property configPath - Project-relative config path for this scenario.
 * @property profileDir - Project-relative runtime profile directory.
 * @usage Scenario tests use this to avoid mutating normal runtime state.
 */
interface ScenarioProfile {
  readonly root: string;
  readonly configPath: string;
  readonly profileDir: string;
}

describe("no-session agent scenario", () => {
  let profile: ScenarioProfile;

  beforeEach(() => {
    profile = createScenarioProfile(`scenario-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  });

  afterEach(() => {
    // Scenario output intentionally remains under .config/runtime/scenarios for review.
  });

  test("keeps continuity through memory without provider sessions", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    expect(memory.isVectorLoaded()).toBe(true);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    const first = await runtime.runTurn({
      conversationId: "local-continuity",
      content: "记住我的项目代号是 flyflor-alpha",
    });
    expect(first.assistantMessage).toContain("flyflor-alpha");

    const second = await runtime.runTurn({
      conversationId: "local-continuity",
      content: "我的项目代号是什么？",
    });
    expect(second.assistantMessage).toContain("flyflor-alpha");
    expect(second.context.recall.length).toBeGreaterThan(0);

    const rebuiltMemory = new MemoryComponent(config);
    const recalled = rebuiltMemory.recall("项目代号是什么", 3);
    expect(recalled.map((item) => item.chunk.content).join("\n")).toContain("flyflor-alpha");
    expect(listMarkdownFiles(config.resolve(`${profile.profileDir}/memory/wiki/sources`)).length).toBeGreaterThan(0);
  });

  test("emits guard and tool events while preserving artifacts", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const events: string[] = [];
    for (const type of ["tool.call", "tool.result", "tool.artifact", "guard.ask", "guard.answer"]) {
      signalBus.subscribe(type, async () => {
        events.push(type);
      });
    }
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const result = await runtime.runTurn({
      conversationId: "tools",
      content: "执行 shell: printf flyflor-tool",
    });
    expect(result.toolResults[0]?.ok).toBe(true);
    expect(result.toolResults[0]?.output).toContain("flyflor-tool");
    expect(result.toolResults[0]?.artifactPath).toBeTruthy();
    expect(result.toolResults[0]?.metadata).toMatchObject({ compression: "none" });
    expect(readFileSync(result.toolResults[0]?.artifactPath ?? "", "utf8")).toContain("flyflor-tool");
    expect(events).toContain("tool.call");
    expect(events).toContain("tool.result");
    expect(events).toContain("tool.artifact");
    expect(events).toContain("guard.ask");
    expect(events).toContain("guard.answer");
  });

  test("forgets stored memory and persists context checkpoints through tools", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    const toolContext = runtime.createToolContext("tool-checkpoint");

    const storeResult = await runtime.getToolRegistry().execute("memory_store", {
      content: "记住我的项目代号是 flyflor-forget",
      sourceId: "forget-scenario",
    }, toolContext);
    const chunkId = Number(storeResult.output.match(/\d+$/)?.[0]);
    expect(memory.recall("flyflor-forget", 3).map((item) => item.chunk.id)).toContain(chunkId);

    const forgetResult = await runtime.getToolRegistry().execute("memory_forget", { id: chunkId }, toolContext);
    expect(forgetResult.ok).toBe(true);
    expect(memory.recall("flyflor-forget", 3).map((item) => item.chunk.id)).not.toContain(chunkId);

    memory.appendMessage("compact-conversation", {
      id: "compact:user",
      role: "user",
      content: "记住 compact 项目代号是 flyflor-compact",
      createdAt: Date.now(),
    });
    const compactResult = await runtime.getToolRegistry().execute("context_compact", {
      conversationId: "compact-conversation",
      reason: "scenario",
    }, toolContext);
    expect(compactResult.ok).toBe(true);
    const rebuiltContext = new ContextBuilderService(config, undefined, memory).build({
      conversationId: "compact-conversation",
      userInput: "继续",
    });
    expect(rebuiltContext.checkpoint?.summary).toContain("flyflor-compact");
    expect(rebuiltContext.messages[0]?.content).toContain("CONTEXT CHECKPOINT");
  });

  test("validates multi-edit atomically and grep empty searches", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    const toolContext = runtime.createToolContext("tool-edit");
    const editFile = join(config.resolve(profile.profileDir), "edit-target.txt");
    writeFileSync(editFile, "alpha\nbeta\ngamma\n", "utf8");

    const dryRun = await runtime.getToolRegistry().execute("multi_edit", {
      dryRun: true,
      edits: [
        { filePath: editFile, oldText: "alpha", newText: "one" },
        { filePath: editFile, oldText: "gamma", newText: "three" },
      ],
    }, toolContext);
    expect(dryRun.ok).toBe(true);
    expect(readFileSync(editFile, "utf8")).toContain("alpha");

    const failed = await runtime.getToolRegistry().execute("multi_edit", {
      edits: [
        { filePath: editFile, oldText: "alpha", newText: "one" },
        { filePath: editFile, oldText: "missing", newText: "none" },
      ],
    }, toolContext);
    expect(failed.ok).toBe(false);
    expect(readFileSync(editFile, "utf8")).toBe("alpha\nbeta\ngamma\n");

    const grep = await runtime.getToolRegistry().execute("grep", {
      pattern: "not-present",
      path: editFile,
    }, toolContext);
    expect(grep.ok).toBe(true);
    expect(grep.output).toBe("");
  });

  test("rejects invalid tool inputs through the registry schema gate", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const events: string[] = [];
    signalBus.subscribe("tool.result", async (payload) => {
      events.push(JSON.stringify(payload));
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const toolContext = runtime.createToolContext("tool-validation");

    const shellResult = await runtime.getToolRegistry().execute("shell", {}, toolContext);
    expect(shellResult.ok).toBe(false);
    expect(shellResult.output).toContain("missing required property command");

    const codeGraphResult = await runtime.getToolRegistry().execute("codegraph", { action: "delete" }, toolContext);
    expect(codeGraphResult.ok).toBe(false);
    expect(codeGraphResult.output).toContain("action must be one of");
    expect(events.join("\n")).toContain("tool input invalid");
  });

  test("registers the phase-one coding tool surface", () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    const toolNames = runtime.getToolRegistry().list().map((tool) => tool.name).sort();
    expect(toolNames).toEqual([
      "codegraph",
      "context_compact",
      "edit",
      "git",
      "glob",
      "grep",
      "memory_forget",
      "memory_recall",
      "memory_store",
      "multi_edit",
      "read",
      "shell",
      "task",
      "write",
    ]);
  });

  test("runs read-only project inspection before answering project analysis", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const projectPath = createScenarioProject(profile);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const events: string[] = [];
    signalBus.subscribe("tool.call", async (payload) => {
      events.push(JSON.stringify(payload));
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const result = await runtime.runTurn({
      conversationId: "project-read",
      content: `仔细阅读这个项目 ${projectPath} 说说你的看法`,
    });
    expect(result.toolResults.length).toBeGreaterThanOrEqual(4);
    expect(result.toolResults.map((item) => item.output).join("\n")).toContain("flyflor-inner-test");
    expect(events.join("\n")).toContain("\"name\":\"glob\"");
    expect(events.join("\n")).toContain("\"name\":\"read\"");
    expect(memory.recall("flyflor-inner-test", 3).length).toBe(0);
  });

  test("does not store question-like messages as durable facts", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    await runtime.runTurn({
      conversationId: "question-memory",
      content: "我的项目代号是什么？",
    });
    expect(countMemoryChunks(config)).toBe(0);
  });

  test("serves the socket test page and completes a WebSocket turn", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    const server = new SocketServerService(config, runtime);
    const handle = server.start({ port: 0 });
    try {
      const page = await fetch(`http://${handle.hostname}:${handle.port}/socket-test.html`);
      expect(page.status).toBe(200);
      expect(await page.text()).toContain("Flyflor Socket Test");

      const envelopes = await collectSocketTurn(`ws://${handle.hostname}:${handle.port}/ws`, {
        id: "client-1",
        type: "chat.message",
        payload: {
          conversationId: "socket",
          content: "记住我的项目代号是 flyflor-socket",
        },
        timestamp: Date.now(),
      });
      expect(envelopes.map((item) => item.type)).toContain("chat.final");
      expect(envelopes.find((item) => item.type === "chat.final")?.payload).toMatchObject({
        content: expect.stringContaining("flyflor-socket"),
      });
    } finally {
      server.stop();
    }
  });

  test("loads Hermes-style model and provider config aliases", () => {
    const config = new ConfigService(profile.root, profile.configPath);
    expect(config.getActiveModelName()).toBe("mock-coding-agent");
    expect(config.getProvider("mock")).toMatchObject({
      name: "mock",
      base_url: "",
      api_key_env: "FLYFLOR_LLM_API_KEY",
      request_timeout_seconds: 300,
      stale_timeout_seconds: 900,
    });

    const aliasProfile = createScenarioProfile(`alias-${Date.now()}-${Math.random().toString(16).slice(2)}`, {
      providers: {
        custom: {
          name: "custom",
          baseUrl: "https://api.example.com/v1",
          apiKey: "local-test-key",
          models: ["alpha", "", "beta"],
        },
      },
    });
    const aliasConfig = new ConfigService(aliasProfile.root, aliasProfile.configPath);
    expect(aliasConfig.getProvider("custom")).toMatchObject({
      name: "custom",
      base_url: "https://api.example.com/v1",
      api_key: "local-test-key",
      models: {
        alpha: {},
        beta: {},
      },
    });
  });

  test("loads local env files before resolving provider keys", () => {
    const envName = "FLYFLOR_SCENARIO_PROVIDER_KEY";
    const previous = process.env[envName];
    delete process.env[envName];

    const envRoot = join(process.cwd(), ".config/runtime/scenarios", `env-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(envRoot, ".config"), { recursive: true });
    writeFileSync(join(envRoot, ".env.local"), `${envName}=env-file-secret\n`, "utf8");
    writeFileSync(
      join(envRoot, ".config/config.jsonc"),
      JSON.stringify(
        {
          paths: {
            templatesDir: "./.config/templates",
            memoryDb: "./.config/memory/memory.db",
            memoryWiki: "./.config/memory/wiki",
            toolArtifacts: "./.config/memory/artifacts",
            sqliteVecDir: "./.config/sqlite-vec",
            codegraphDir: "./.config/codegraph",
            socketTestPage: "./.config/web/socket-test.html",
            runtimeDir: "./.config/runtime",
          },
          runtime: { autoApproveGuards: true },
          socket: { host: "127.0.0.1", port: 0 },
          prompts: { system: "./prompts/system.md" },
          model: {
            default: "deepseek-v4-flash",
            provider: "deepseek",
            base_url: "",
            api_key_env: envName,
            api_key: "",
            request_timeout_seconds: 300,
            stale_timeout_seconds: 900,
            max_tokens: null,
            context_length: null,
          },
          providers: {
            deepseek: {
              base_url: "https://api.deepseek.com",
              api_key_env: envName,
              api_key: "",
              request_timeout_seconds: 300,
              stale_timeout_seconds: 900,
              models: { "deepseek-v4-flash": {} },
            },
          },
          tools: {
            rtk: { enabled: true, command: "rtk" },
            codegraph: { enabled: true, command: "codegraph" },
          },
          memory: { embeddingDimensions: 4, enableSqliteVec: true },
          context: { recentTurns: 6, maxRecall: 6 },
        },
        null,
        2,
      ),
      "utf8",
    );

    try {
      const config = new ConfigService(envRoot);
      expect(config.getProvider("deepseek")?.api_key).toBe("env-file-secret");
    } finally {
      if (previous === undefined) {
        delete process.env[envName];
      } else {
        process.env[envName] = previous;
      }
    }
  });
});

/**
 * Creates a project-local isolated scenario config.
 *
 * @param name - Unique scenario profile name.
 * @returns Scenario profile paths.
 * @usage Tests call this before constructing ConfigService.
 */
function createScenarioProfile(name: string, overrides: Record<string, unknown> = {}): ScenarioProfile {
  const root = process.cwd();
  const profileDir = `./.config/runtime/scenarios/${name}`;
  const configPath = `${profileDir}/config.jsonc`;
  const config = {
    paths: {
      templatesDir: "./.config/templates",
      memoryDb: `${profileDir}/memory/memory.db`,
      memoryWiki: `${profileDir}/memory/wiki`,
      toolArtifacts: `${profileDir}/memory/artifacts`,
      sqliteVecDir: "./.config/sqlite-vec",
      codegraphDir: `${profileDir}/codegraph`,
      socketTestPage: "./.config/web/socket-test.html",
      runtimeDir: `${profileDir}/runtime`,
    },
    runtime: { autoApproveGuards: true },
    socket: { host: "127.0.0.1", port: 0 },
    prompts: { system: "./prompts/system.md" },
    model: {
      default: "mock-coding-agent",
      provider: "mock",
      base_url: "",
      api_key_env: "FLYFLOR_LLM_API_KEY",
      api_key: "",
      request_timeout_seconds: 300,
      stale_timeout_seconds: 900,
      max_tokens: null,
      context_length: null,
    },
    providers: {
      mock: {
        base_url: "",
        api_key_env: "FLYFLOR_LLM_API_KEY",
        api_key: "",
        request_timeout_seconds: 300,
        stale_timeout_seconds: 900,
        models: { "mock-coding-agent": {} },
      },
    },
    tools: {
      rtk: { enabled: true, command: "rtk" },
      codegraph: { enabled: true, command: "codegraph" },
    },
    memory: { embeddingDimensions: 4, enableSqliteVec: true },
    context: { recentTurns: 6, maxRecall: 6 },
    ...overrides,
  };
  mkdirSync(dirname(join(root, configPath)), { recursive: true });
  writeFileSync(join(root, configPath), JSON.stringify(config, null, 2), "utf8");
  return { root, configPath, profileDir };
}

/**
 * Creates a tiny local project for project-read scenario testing.
 *
 * @param profile - Scenario profile that owns runtime output paths.
 * @returns Absolute project path.
 * @usage Project inspection tests need a real filesystem target without touching repo files.
 */
function createScenarioProject(profile: ScenarioProfile): string {
  const projectDir = join(profile.root, profile.profileDir, "sample-project");
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "flyflor-inner-test", type: "module" }, null, 2), "utf8");
  writeFileSync(join(projectDir, "README.md"), "# flyflor-inner-test\n\nScenario project for inspection.\n", "utf8");
  writeFileSync(join(projectDir, "src/index.ts"), "export class InnerTestApp { public readonly name = 'flyflor-inner-test'; }\n", "utf8");
  return projectDir;
}

/**
 * Counts durable memory chunks in an isolated scenario DB.
 *
 * @param config - Config service pointing at a scenario profile.
 * @returns Number of stored memory chunks.
 * @usage Scenario tests verify that questions do not become durable facts.
 */
function countMemoryChunks(config: ConfigService): number {
  const row = new Database(config.resolve(config.getConfig().paths.memoryDb))
    .query("select count(*) as count from memory_chunks")
    .get() as { readonly count: number };
  return row.count;
}

/**
 * Lists generated Markdown projection files under one directory.
 *
 * @param dir - Absolute projection directory.
 * @returns Markdown filenames found in the directory.
 * @usage Scenario tests verify memory.db writes also produce human-review projections.
 */
function listMarkdownFiles(dir: string): readonly string[] {
  if (!existsSync(dir)) {
    return [];
  }
  return readdirSync(dir).filter((fileName) => fileName.endsWith(".md"));
}

/**
 * Sends one WebSocket chat envelope and collects server events until turn completion.
 *
 * @param url - WebSocket URL.
 * @param envelope - Client envelope to send.
 * @returns Server envelopes observed during the turn.
 * @usage Socket scenario test verifies real transport behavior.
 */
async function collectSocketTurn(url: string, envelope: SocketEnvelope): Promise<readonly SocketEnvelope[]> {
  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const envelopes: SocketEnvelope[] = [];
    const timeout = setTimeout(() => {
      socket.close();
      reject(new Error("socket scenario timed out"));
    }, 5000);
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify(envelope));
    });
    socket.addEventListener("message", (event) => {
      const parsed = JSON.parse(String(event.data)) as SocketEnvelope;
      envelopes.push(parsed);
      if (parsed.type === "chat.turn.complete") {
        clearTimeout(timeout);
        socket.close();
        resolve(envelopes);
      }
    });
    socket.addEventListener("error", () => {
      clearTimeout(timeout);
      reject(new Error("socket scenario failed"));
    });
  });
}
