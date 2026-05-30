import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigService } from "../../src/config/config.service";
import { ContextBuilderService } from "../../src/context";
import { AgentRuntimeService } from "../../src/kernel";
import { MemoryComponent } from "../../src/memory";
import { RtkCommandFilterComponent } from "../../src/plugins";
import { SignalBus } from "../../src/signal";
import { SocketServerService, type SocketEnvelope } from "../../src/socket";
import { ArtifactWriterComponent, GitTool } from "../../src/tools";

const rootScenarioConfig = new ConfigService();
const rootDeepSeekProvider = rootScenarioConfig.getProvider("deepseek");
const scenarioModelName = rootScenarioConfig.getActiveModelName();

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
    expect(second.context.intent?.diagnosticSource).toBe("model");
    expect(second.context.intent?.contextSourcesToInject).toEqual(expect.arrayContaining(["current_user", "runtime"]));

    const rebuiltMemory = new MemoryComponent(config);
    const recalled = rebuiltMemory.recall("项目代号是什么", 3);
    expect(recalled.map((item) => item.chunk.content).join("\n")).toContain("flyflor-alpha");
    expect(listMarkdownFiles(config.resolve(`${profile.profileDir}/memory/wiki/sources`)).length).toBeGreaterThan(0);
  }, 120_000);

  test("does not expose tools or previous task tail for a direct greeting decision", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    memory.appendMessage("greeting-clean", {
      id: "old:user",
      role: "user",
      content: "请阅读 /tmp/flyflor-front 并添加 lint:fix",
      createdAt: Date.now() - 2000,
    });
    memory.appendMessage("greeting-clean", {
      id: "old:assistant",
      role: "assistant",
      content: "我将读取 package.json 并运行 shell。",
      createdAt: Date.now() - 1000,
    });
    const signalBus = new SignalBus(true);
    const toolVisibility: unknown[] = [];
    const toolCalls: unknown[] = [];
    signalBus.subscribe("tool.visibility.resolved", async (payload) => {
      toolVisibility.push(payload);
    });
    signalBus.subscribe("tool.call", async (payload) => {
      toolCalls.push(payload);
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );

    const result = await runtime.runTurn({
      conversationId: "greeting-clean",
      content: "你好",
    });

    expect(result.context.recentMessages).toHaveLength(0);
    expect(result.context.messages.map((message) => message.content).join("\n")).not.toContain("lint:fix");
    expect(result.context.intent?.mode).toBe("direct_reply");
    expect(result.context.intent?.diagnosticSource).toBe("model");
    expect(result.context.intent?.contextPolicy).toBe("isolated");
    expect(result.context.intent?.targetConfidence).toBe("none");
    expect(memory.recentRetrievalTraces(1, "greeting-clean")).toHaveLength(0);
    expect(toolVisibility).toEqual([expect.objectContaining({
      contextPolicy: "isolated",
      targetConfidence: "none",
      toolNames: [],
    })]);
    expect(toolCalls).toHaveLength(0);
    expect(result.toolResults).toHaveLength(0);
  }, 120_000);

  test("asks for clarification when the model sees multiple knowledge-tree task candidates", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    memory.upsertTask({
      namespace: "front",
      title: "flyflor-front lint:fix",
      status: "in_progress",
      sourceKind: "scenario",
      sourceId: "task-a",
    });
    memory.upsertTask({
      namespace: "front",
      title: "flyflor-front prettier config",
      status: "in_progress",
      sourceKind: "scenario",
      sourceId: "task-b",
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );

    const result = await runtime.runTurn({
      conversationId: "clarify-reference",
      content: "继续处理 flyflor-front",
    });

    expect(result.context.intent).toMatchObject({
      mode: "clarify_reference",
      needsClarification: true,
      contextPolicy: "task_scoped",
      targetConfidence: "ambiguous",
      toolGroupsToExpose: [],
    });
    expect(result.context.intent?.candidateTaskIds.length).toBeGreaterThanOrEqual(2);
    expect(result.context.intent?.cluePacket.knowledgeTree.tasks.length).toBeGreaterThanOrEqual(2);
    expect(result.toolResults).toHaveLength(0);
  }, 60_000);

  test("rebuilds critical memory indexes from brain audit after memory loss", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    const projectCode = `flyflor-replay-${Date.now().toString(36)}`;
    await runtime.runTurn({
      conversationId: "brain-replay",
      content: `记住我的项目代号是 ${projectCode}`,
    });

    const recoveryConfigPath = `${profile.profileDir}/recovery/config.jsonc`;
    const base = config.getConfig();
    mkdirSync(dirname(join(profile.root, recoveryConfigPath)), { recursive: true });
    writeFileSync(join(profile.root, recoveryConfigPath), JSON.stringify({
      ...base,
      paths: {
        ...base.paths,
        memoryDb: `${profile.profileDir}/recovery/memory/memory.db`,
        memoryWiki: `${profile.profileDir}/recovery/memory/wiki`,
        toolArtifacts: `${profile.profileDir}/recovery/memory/artifacts`,
        pluginStateDir: `${profile.profileDir}/recovery/plugins`,
        runtimeDir: `${profile.profileDir}/recovery/runtime`,
      },
    }, null, 2), "utf8");

    const recoveredConfig = new ConfigService(profile.root, recoveryConfigPath);
    const recoveredMemory = new MemoryComponent(recoveredConfig);
    const result = recoveredMemory.rebuildCriticalIndexesFromBrain(brainDatabasePath(config, profile.profileDir));

    expect(result.messages).toBeGreaterThanOrEqual(2);
    expect(result.chunks).toBeGreaterThanOrEqual(1);
    expect(result.facts).toBeGreaterThanOrEqual(1);
    expect(recoveredMemory.recall("项目代号是什么", 3).map((item) => item.chunk.content).join("\n")).toContain(projectCode);
    expect(recoveredMemory.recallFacts("项目代号是什么", 3).map((fact) => fact.object)).toContain(projectCode);
  }, 90_000);

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
    const result = await runtime.getToolRegistry().execute("shell", { command: "printf flyflor-tool" }, runtime.createToolContext("shell-direct"));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("flyflor-tool");
    expect(result.artifactPath).toBeTruthy();
    expect(result.metadata).toMatchObject({ compression: "none" });
    expect(readFileSync(result.artifactPath ?? "", "utf8")).toContain("flyflor-tool");
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
    expect(memory.latestCheckpoint("compact-conversation")?.summary).toContain("flyflor-compact");
    const rebuiltContext = new ContextBuilderService(config, undefined, memory).build({
      conversationId: "compact-conversation",
      userInput: "continue",
      intent: {
        decisionId: "test-decision",
        primary: "chat",
        mode: "direct_reply",
        confidence: 1,
        requiresProjectInspection: false,
        contextPolicy: "isolated",
        targetConfidence: "none",
        candidateTaskIds: [],
        needsClarification: false,
        contextSourcesToInject: ["current_user", "runtime", "checkpoint"],
        toolGroupsToExpose: [],
        factsToStore: [],
        reasons: ["test"],
        diagnosticSource: "model",
        cluePacket: {
          conversationId: "compact-conversation",
          userInput: "continue",
          recentConversation: [],
          knowledgeTree: {
            query: "continue",
            chunks: [],
            facts: [],
            entities: [],
            relations: [],
            claims: [],
            decisions: [],
            tasks: [],
            artifacts: [],
            diagnostics: [],
          },
        },
      },
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

  test("requests visible workmux tasks without hidden child processes", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const requests: unknown[] = [];
    signalBus.subscribe("workmux.task.requested", async (payload) => {
      requests.push(payload);
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const result = await runtime.getToolRegistry().execute("task", {
      description: "Implement plugin diagnostics",
      prompt: "Read AGENTS.md and PLAN.md, then implement the owned files.",
      ownedFiles: ["src/plugins/**"],
      forbiddenFiles: ["src/kernel/**"],
      validationCommands: ["bunx tsc --noEmit"],
      handoffConditions: ["STATUS.md handoff-ready"],
    }, runtime.createToolContext("task-visible"));

    expect(result.ok).toBe(true);
    expect(result.output).toContain("launchMode=visible-cmux");
    expect(result.output).toContain("spawned=false");
    expect(result.metadata).toMatchObject({
      laneName: "implement-plugin-diagnostics",
      worktreePath: "./.worktrees/implement-plugin-diagnostics",
      launchMode: "visible-cmux",
      spawned: false,
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      turnId: "task-visible",
      request: expect.objectContaining({
        laneName: "implement-plugin-diagnostics",
        launchMode: "visible-cmux",
        spawned: false,
      }),
    });
  });

  test("registers the coding tool surface", () => {
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
    expect(toolNames.filter((name) => name === "codegraph")).toHaveLength(1);
    expect(runtime.getToolRegistry().list().find((tool) => tool.name === "read")?.execution).toEqual({
      mutability: "read-only",
      concurrency: "concurrent",
    });
    expect(runtime.getToolRegistry().list().find((tool) => tool.name === "write")?.execution).toEqual({
      mutability: "mutating",
      concurrency: "serial",
    });
  });

  test("emits project-local plugin unavailable diagnostics without global tools", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const diagnostics: unknown[] = [];
    signalBus.subscribe("plugin.availability", async (payload) => {
      diagnostics.push(payload);
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );

    await runtime.runTurn({
      conversationId: "plugin-unavailable",
      content: "普通聊天，不需要插件",
    });

    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        name: "codegraph",
        available: false,
        reason: "auto-install-disabled",
        tools: ["codegraph"],
      }),
      expect.objectContaining({
        name: "rtk",
        available: false,
        reason: "auto-install-disabled",
        tools: [],
      }),
    ]));
    expect(existsSync(config.resolve(`${profile.profileDir}/plugins/plugin-status.json`))).toBe(true);
  }, 60_000);

  test("preserves RTK raw artifacts and emits unavailable diagnostics for noisy commands", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const unavailable: unknown[] = [];
    const artifacts: unknown[] = [];
    signalBus.subscribe("plugin.unavailable", async (payload) => {
      unavailable.push(payload);
    });
    signalBus.subscribe("tool.artifact", async (payload) => {
      artifacts.push(payload);
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const result = await new GitTool(new ArtifactWriterComponent(), new RtkCommandFilterComponent(config))
      .execute({ args: ["status", "--short"] }, runtime.createToolContext("rtk-raw"));

    expect(result.ok).toBe(false);
    expect(result.artifactPath).toContain(`${profile.profileDir.replace("./", "")}/memory/artifacts/rtk`);
    expect(readFileSync(result.artifactPath ?? "", "utf8")).toContain("$ git status --short");
    expect(result.metadata).toMatchObject({
      compression: "none",
      status: "unavailable",
    });
    expect(artifacts).toEqual([expect.objectContaining({ kind: "rtk.raw" })]);
    expect(unavailable).toEqual([expect.objectContaining({
      name: "rtk",
      status: "unavailable",
      toolName: "git",
    })]);
  });

  test("keeps CodeGraph coding-only and refuses root index creation", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const projectPath = createScenarioProject(profile);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const failures: unknown[] = [];
    signalBus.subscribe("plugin.failed", async (payload) => {
      failures.push(payload);
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const codegraph = runtime.getToolRegistry().list().find((tool) => tool.name === "codegraph");
    expect(codegraph?.description).toContain("coding/codebase turns only");
    expect(codegraph?.execution).toEqual({ mutability: "read-only", concurrency: "concurrent" });

    const result = await runtime.getToolRegistry().execute("codegraph", {
      action: "index",
      intent: "coding",
    }, { ...runtime.createToolContext("codegraph-index"), cwd: projectPath });

    expect(result.output).toMatch(/codegraph unavailable|codegraph index refused/);
    expect(result.metadata).toMatchObject({
      status: "failed",
      reason: "external-index-placement-unverified",
    });
    expect(existsSync(join(projectPath, ".codegraph"))).toBe(false);
    expect(failures).toEqual([expect.objectContaining({
      name: "codegraph",
      status: "failed",
    })]);
  });

  test("runs read-only project inspection before answering project analysis", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const projectPath = createScenarioProject(profile);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const events: string[] = [];
    const contextDiagnostics: unknown[] = [];
    signalBus.subscribe("tool.call", async (payload) => {
      events.push(JSON.stringify(payload));
    });
    signalBus.subscribe("context.ready", async (payload) => {
      contextDiagnostics.push(payload);
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
    expect(result.context.intent).toMatchObject({
      primary: "coding_inspection",
      mode: "investigate",
      requiresProjectInspection: true,
      projectPath,
      contextPolicy: "project_scoped",
      targetConfidence: "unique",
      diagnosticSource: "model",
    });
    expect(JSON.stringify(contextDiagnostics)).toContain("\"primary\":\"coding_inspection\"");
    expect(events.join("\n")).toContain("\"name\":\"glob\"");
    expect(events.join("\n")).toContain("\"name\":\"read\"");
    expect(memory.recall("flyflor-inner-test", 3).length).toBe(0);

    const db = new Database(brainDatabasePath(config, profile.profileDir));
    const intentEvent = db.query("select payload from brain_events where conversation_id = ? and type = ? order by created_at desc limit 1")
      .get("project-read", "context.intent") as { readonly payload: string };
    expect(intentEvent.payload).toContain("\"primary\":\"coding_inspection\"");
  }, 120_000);

  test("pre-turn compaction preserves recalled facts and writes diagnostics", async () => {
    const compactProfile = createScenarioProfile(`compact-guard-${Date.now()}-${Math.random().toString(16).slice(2)}`, {
      context: { recentTurns: 14, maxRecall: 6, maxContextChars: 9000, maxToolSteps: 8 },
    });
    const config = new ConfigService(compactProfile.root, compactProfile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const compactions: unknown[] = [];
    signalBus.subscribe("context.compacted", async (payload) => {
      compactions.push(payload);
    });
    const factRuntime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );

    await factRuntime.runTurn({
      conversationId: "budget-guard",
      content: "记住我的项目代号是 flyflor-budget",
    });
    const base = Date.now() + 1000;
    for (let index = 0; index < 24; index += 1) {
      memory.appendMessage("budget-guard", {
        id: `bulk:${index}`,
        role: index % 2 === 0 ? "user" : "assistant",
        content: `bulk ${index} requirement must preserve src/context/context.builder.service.ts DecisionRecord TaskItem ConflictNote ${"x".repeat(900)}`,
        createdAt: base + index,
      });
    }

    const result = await runtime.runTurn({
      conversationId: "budget-guard",
      content: "我的项目代号是什么？",
    });
    expect(result.assistantMessage).toContain("flyflor-budget");
    expect(result.context.intent?.diagnosticSource).toBe("model");
    expect(result.context.intent?.contextSourcesToInject).toEqual(expect.arrayContaining(["current_user", "runtime"]));

    const db = new Database(brainDatabasePath(config, compactProfile.profileDir));
    const decisionEvent = db.query("select payload from brain_events where conversation_id = ? and type = ? order by created_at desc limit 1")
      .get("budget-guard", "turn.decision.completed") as { readonly payload: string };
    expect(decisionEvent.payload).toContain("flyflor-budget");
    expect(compactions).toHaveLength(0);
  }, 120_000);

  test("tool artifacts preserve large output anchors without a model shim", async () => {
    const compactProfile = createScenarioProfile(`midturn-${Date.now()}-${Math.random().toString(16).slice(2)}`, {
      context: { recentTurns: 2, maxRecall: 2, maxContextChars: 7000, maxToolSteps: 4 },
    });
    const config = new ConfigService(compactProfile.root, compactProfile.configPath);
    const memory = new MemoryComponent(config);
    const hugeFile = join(config.resolve(compactProfile.profileDir), "huge-tool-output.txt");
    mkdirSync(dirname(hugeFile), { recursive: true });
    writeFileSync(hugeFile, `src/context/context.compressor.component.ts\nDecisionRecord must survive\n${"z".repeat(12000)}`, "utf8");
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    const result = await runtime.getToolRegistry().execute("read", {
      filePath: `${compactProfile.profileDir}/huge-tool-output.txt`,
      limit: 12000,
    }, runtime.createToolContext("large-read-direct"));
    expect(result.ok).toBe(true);
    expect(result.output).toContain("DecisionRecord must survive");
    expect(result.metadata).toMatchObject({ path: `${compactProfile.profileDir.replace("./", "")}/huge-tool-output.txt` });
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
  }, 120_000);

  test("recalls current fact through tree evidence without stale unrelated project facts", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const staleChunk = memory.store({
      sourceKind: "scenario",
      sourceId: "archive-project",
      content: "archive-project 的项目代号是 flyflor-archive-stale",
      importance: 1,
    });
    memory.upsertFact({
      namespace: "archive-project",
      subject: "项目代号",
      predicate: "is",
      object: "flyflor-archive-stale",
      sourceKind: "chunk",
      sourceId: String(staleChunk.id),
    });
    const currentChunk = memory.store({
      sourceKind: "scenario",
      sourceId: "active-project",
      content: "active-project 当前项目代号是 flyflor-tree-current",
      importance: 1,
    });
    memory.upsertFact({
      namespace: "active-project",
      subject: "项目代号",
      predicate: "is",
      object: "flyflor-tree-current",
      confidence: 0.95,
      sourceKind: "chunk",
      sourceId: String(currentChunk.id),
    });

    const recalled = memory.treeRecall("active-project 当前项目代号是什么？", 1, { conversationId: "tree-no-session" });
    expect(recalled.facts.map((fact) => fact.object)).toEqual(["flyflor-tree-current"]);
    expect(recalled.chunks.map((item) => item.chunk.content).join("\n")).not.toContain("flyflor-archive-stale");
    const trace = memory.recentRetrievalTraces(1, "tree-no-session")[0];
    expect(trace?.strategy).toContain("tree");
    expect(trace?.diagnostics).toContain("graph-neighborhood");
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
  }, 90_000);

  test("keeps socket test page usable as a static file with rich debug categories", () => {
    const html = readFileSync(join(process.cwd(), ".config/web/socket-test.html"), "utf8");
    expect(html).toContain("ws://127.0.0.1:17361/ws");
    expect(html).toContain("location.protocol === \"file:\"");
    expect(html).toContain("debugCategories");
    expect(html).toContain("function createEnvelopeId()");
    expect(html).toContain("typeof globalThis.crypto.randomUUID === \"function\"");
    expect(html).toContain("client.send.blocked");
    for (const category of ["chat", "tool", "memory", "context", "model", "recovery", "workmux", "plugin", "socket", "error"]) {
      expect(html).toContain(`"${category}"`);
    }
    expect(html).not.toContain("https://");
    expect(html).not.toContain("<script src=");
    expect(html).not.toContain("<link rel=\"stylesheet\"");
  });

  test("marks failed real-provider turns in memory and brain audit", async () => {
    const brokenProfile = createScenarioProfile(`provider-failure-${Date.now()}-${Math.random().toString(16).slice(2)}`, {
      model: {
        default: scenarioModelName,
        provider: "deepseek",
        base_url: "",
        api_key_env: "FLYFLOR_SCENARIO_MISSING_KEY",
        api_key: "",
        request_timeout_seconds: 300,
        stale_timeout_seconds: 900,
        max_tokens: 512,
        context_length: null,
      },
      providers: {
        deepseek: {
          base_url: rootDeepSeekProvider?.base_url ?? "https://api.deepseek.com",
          api_key_env: "FLYFLOR_SCENARIO_MISSING_KEY",
          api_key: "",
          request_timeout_seconds: 300,
          stale_timeout_seconds: 900,
          models: {
            [scenarioModelName]: {
              context_length: rootDeepSeekProvider?.models[scenarioModelName]?.context_length ?? null,
              max_tokens: 512,
            },
          },
        },
      },
    });
    const config = new ConfigService(brokenProfile.root, brokenProfile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const errors: unknown[] = [];
    signalBus.subscribe("agent.error", async (payload) => {
      errors.push(payload);
    });
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );

    await expect(runtime.runTurn({
      conversationId: "failure-audit",
      content: "触发失败审计",
    })).rejects.toThrow("Missing API key for provider deepseek");

    expect(memory.getRecoveryState("active-turn")).toMatchObject({
      state: "turn.failed",
      payload: expect.objectContaining({
        conversationId: "failure-audit",
        error: "Missing API key for provider deepseek",
      }),
    });
    expect(errors).toHaveLength(1);

    const brainDbPath = brainDatabasePath(config, brokenProfile.profileDir);
    const db = new Database(brainDbPath);
    const turn = db.query("select status, error from brain_turns where conversation_id = ? order by started_at desc limit 1")
      .get("failure-audit") as { readonly status: string; readonly error: string };
    const recovery = db.query("select state from brain_recovery_points where conversation_id = ? order by created_at desc limit 1")
      .get("failure-audit") as { readonly state: string };
    expect(turn).toMatchObject({ status: "failed", error: "Missing API key for provider deepseek" });
    expect(recovery).toMatchObject({ state: "turn.failed" });
  }, 60_000);

  test("rejects escaped file paths through the tool boundary", async () => {
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      new SignalBus(true),
    );
    await expect(runtime.getToolRegistry().execute("read", {
      filePath: "/tmp/flyflor-outside.txt",
    }, runtime.createToolContext("escaped-read"))).rejects.toThrow("Path escapes tool cwd");
  });

  test("broadcasts tool, guard, artifact, and memory events over WebSocket", async () => {
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
      const envelopes = await collectSocketTurn(`ws://${handle.hostname}:${handle.port}/ws`, {
        id: "client-events",
        type: "chat.message",
        payload: {
          conversationId: "socket-events",
          content: "执行 shell: printf flyflor-socket-tool",
        },
        timestamp: Date.now(),
      });
      const types = envelopes.map((item) => item.type);
      expect(types).toContain("guard.ask");
      expect(types).toContain("guard.answer");
      expect(types).toContain("tool.call");
      expect(types).toContain("tool.artifact");
      expect(types).toContain("tool.result");
      expect(types).toContain("memory.recall");
      expect(envelopes.find((item) => item.type === "tool.result")?.payload).toMatchObject({
        result: expect.objectContaining({
          output: expect.stringContaining("flyflor-socket-tool"),
        }),
      });
    } finally {
      server.stop();
    }
  }, 90_000);

  test("loads Hermes-style model and provider config aliases", () => {
    const config = new ConfigService(profile.root, profile.configPath);
    expect(config.getActiveModelName()).toBe(scenarioModelName);
    expect(config.getProvider("deepseek")).toMatchObject({
      name: "deepseek",
      base_url: rootDeepSeekProvider?.base_url ?? "https://api.deepseek.com",
      api_key_env: "DEEPSEEK_API_KEY",
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

  test("loads project env before resolving and merging provider keys", () => {
    const envName = "FLYFLOR_SCENARIO_PROVIDER_KEY";
    const previous = process.env[envName];
    delete process.env[envName];

    const envRoot = join(process.cwd(), ".config/runtime/scenarios", `env-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    mkdirSync(join(envRoot, ".config"), { recursive: true });
    writeFileSync(join(envRoot, ".env"), `${envName}=env-file-secret\n`, "utf8");
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
            api_key_env: "FLYFLOR_MISSING_MODEL_KEY",
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
      expect(config.getConfig().model.api_key).toBe("env-file-secret");
      expect(config.getConfig().providers.deepseek?.api_key).toBe("env-file-secret");
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
      brainDir: `${profileDir}/brain`,
      brainArtifacts: `${profileDir}/brain/artifacts`,
      sqliteVecDir: "./.config/sqlite-vec",
      codegraphDir: `${profileDir}/codegraph`,
      externalPluginsDir: `${profileDir}/external-plugins`,
      pluginStateDir: `${profileDir}/plugins`,
      socketTestPage: "./.config/web/socket-test.html",
      runtimeDir: `${profileDir}/runtime`,
    },
    runtime: { autoApproveGuards: true },
    socket: { host: "127.0.0.1", port: 0 },
    prompts: { system: "./prompts/system.md" },
    model: {
      default: scenarioModelName,
      provider: "deepseek",
      base_url: "",
      api_key_env: "DEEPSEEK_API_KEY",
      api_key: "",
      request_timeout_seconds: 300,
      stale_timeout_seconds: 900,
      max_tokens: 512,
      context_length: null,
    },
    providers: {
      deepseek: {
        base_url: rootDeepSeekProvider?.base_url ?? "https://api.deepseek.com",
        api_key_env: "DEEPSEEK_API_KEY",
        api_key: "",
        request_timeout_seconds: 300,
        stale_timeout_seconds: 900,
        models: {
          [scenarioModelName]: {
            context_length: rootDeepSeekProvider?.models[scenarioModelName]?.context_length ?? null,
            max_tokens: 512,
          },
        },
      },
    },
    tools: {
      rtk: { enabled: true, command: "rtk" },
      codegraph: { enabled: true, command: "codegraph" },
    },
    plugins: {
      enabled: true,
      autoload: true,
      autoInstall: false,
      registry: {
        rtk: {
          enabled: true,
          required: false,
          installPath: `${profileDir}/external-plugins/rtk`,
          executable: "target/release/rtk",
          executableCandidates: ["target/release/rtk", "rtk", "bin/rtk", "dist/rtk"],
          installCommands: ["cargo build --release"],
          installTimeoutSeconds: 180,
          source: {
            kind: "git",
            url: "https://github.com/rtk-ai/rtk.git",
            ref: "master",
          },
        },
        codegraph: {
          enabled: true,
          required: false,
          installPath: `${profileDir}/external-plugins/codegraph`,
          executable: "dist/bin/codegraph.js",
          executableCandidates: ["dist/bin/codegraph.js", "codegraph", "bin/codegraph", "node_modules/.bin/codegraph"],
          installCommands: ["npm install", "npm run build"],
          installTimeoutSeconds: 180,
          source: {
            kind: "git",
            url: "https://github.com/colbymchenry/codegraph.git",
            ref: "main",
          },
        },
      },
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
 * Resolves the monthly brain database path for an isolated scenario profile.
 *
 * @param config - Config service that owns path resolution.
 * @param profileDir - Scenario profile directory.
 * @returns Absolute path to the current monthly brain database.
 * @usage Tests query audit rows without reaching into BrainComponent internals.
 */
function brainDatabasePath(config: ConfigService, profileDir: string): string {
  const date = new Date();
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return config.resolve(`${profileDir}/brain/${month}.brain.db`);
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
    }, 90_000);
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
