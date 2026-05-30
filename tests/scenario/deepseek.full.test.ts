import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { config as loadDotenv } from "dotenv";
import { ConfigService } from "../../src/config/config.service";
import { ContextBuilderService } from "../../src/context";
import { AgentRuntimeService } from "../../src/kernel";
import { MemoryComponent } from "../../src/memory";
import { SignalBus } from "../../src/signal";

/**
 * Describes one observed runtime event in the full DeepSeek scenario.
 *
 * @property type - SignalBus event name.
 * @property payload - Raw runtime payload emitted by the agent.
 * @usage The test uses events as transport-level evidence instead of relying only on assistant prose.
 */
interface ObservedEvent {
  readonly type: string;
  readonly payload: unknown;
}

/**
 * Describes one isolated real-model scenario profile.
 *
 * @property root - Repository root used by ConfigService.
 * @property configPath - Project-relative config path for the scenario.
 * @property profileDir - Project-relative runtime output directory.
 * @usage Real-model tests keep memory, brain, artifacts, and plugin state out of normal runtime paths.
 */
interface RealModelProfile {
  readonly root: string;
  readonly configPath: string;
  readonly profileDir: string;
}

loadLocalEnv();
const rootConfig = new ConfigService();
const deepseekProvider = rootConfig.getProvider("deepseek");
const hasDeepSeekCredential = Boolean(deepseekProvider?.api_key);

describe("DeepSeek full no-session coding agent scenario", () => {
  test("covers memory continuity, tool execution, project inspection, brain audit, and recovery", async () => {
    expect(hasDeepSeekCredential).toBe(true);
    const profile = createRealModelProfile(`deepseek-full-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const config = new ConfigService(profile.root, profile.configPath);
    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const events: ObservedEvent[] = [];
    for (const type of [
      "chat.final",
      "context.ready",
      "memory.recall",
      "tool.call",
      "tool.result",
      "recovery.scan",
      "agent.error",
    ]) {
      signalBus.subscribe(type, async (payload) => {
        events.push({ type, payload });
      });
    }
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );

    const projectCode = `flyflor-real-${Date.now().toString(36)}`;
    await runtime.runTurn({
      conversationId: "real-continuity",
      content: `记住我的项目代号是 ${projectCode}`,
    });
    const continuity = await runtime.runTurn({
      conversationId: "real-continuity",
      content: "我的项目代号是什么？请只回答项目代号。",
    });
    expect(continuity.assistantMessage).toContain(projectCode);
    expect(continuity.context.facts.map((fact) => fact.object)).toContain(projectCode);
    expect(memory.getRecoveryState("active-turn")).toMatchObject({ state: "turn.completed" });

    const shell = await runtime.runTurn({
      conversationId: "real-tools",
      content: "执行 shell: printf flyflor-real-tool\n请根据工具结果回答。",
    });
    expect(shell.toolResults.map((result) => result.output).join("\n")).toContain("flyflor-real-tool");

    const projectPath = createRealProject(profile);
    const project = await runtime.runTurn({
      conversationId: "real-project",
      content: `仔细阅读这个项目 ${projectPath} 说说你的看法`,
    });
    expect(project.toolResults.length).toBeGreaterThanOrEqual(4);
    expect(project.toolResults.map((result) => result.output).join("\n")).toContain("flyflor-real-project");
    expect(project.context.recall.length).toBe(0);

    const eventTypes = events.map((event) => event.type);
    expect(eventTypes).toContain("memory.recall");
    expect(eventTypes).toContain("context.ready");
    expect(eventTypes).toContain("tool.call");
    expect(eventTypes).toContain("tool.result");

    const db = new Database(brainDatabasePath(config, profile.profileDir));
    const turnCount = db.query("select count(*) as count from brain_turns where status = 'completed'")
      .get() as { readonly count: number };
    const failedTurnCount = db.query("select count(*) as count from brain_turns where status = 'failed'")
      .get() as { readonly count: number };
    const messageCount = db.query("select count(*) as count from brain_messages")
      .get() as { readonly count: number };
    const toolCount = db.query("select count(*) as count from brain_tool_calls")
      .get() as { readonly count: number };
    const recoveryCount = db.query("select count(*) as count from brain_recovery_points where state = 'turn.completed'")
      .get() as { readonly count: number };
    expect(turnCount.count).toBeGreaterThanOrEqual(4);
    expect(failedTurnCount.count).toBe(0);
    expect(messageCount.count).toBeGreaterThanOrEqual(8);
    expect(toolCount.count).toBeGreaterThanOrEqual(4);
    expect(recoveryCount.count).toBeGreaterThanOrEqual(4);
  }, 240_000);
});

/**
 * Creates an isolated config that uses the project DeepSeek provider credentials.
 *
 * @param name - Unique scenario profile name.
 * @returns Profile paths used by the real-model scenario.
 * @usage Keeps real LLM coverage from mutating normal `.config/memory` or `.config/brain` state.
 */
function createRealModelProfile(name: string): RealModelProfile {
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
      default: rootConfig.getActiveModelName(),
      provider: "deepseek",
      base_url: "",
      api_key_env: "DEEPSEEK_API_KEY",
      api_key: "",
      request_timeout_seconds: 120,
      stale_timeout_seconds: 120,
      max_tokens: 1600,
      context_length: null,
    },
    providers: {
      deepseek: {
        base_url: deepseekProvider?.base_url ?? "https://api.deepseek.com",
        api_key_env: "DEEPSEEK_API_KEY",
        api_key: "",
        request_timeout_seconds: 120,
        stale_timeout_seconds: 120,
        models: {
          [rootConfig.getActiveModelName()]: {
            context_length: deepseekProvider?.models[rootConfig.getActiveModelName()]?.context_length ?? null,
            max_tokens: 1600,
          },
        },
      },
    },
    tools: {
      rtk: { enabled: true, command: "rtk" },
      codegraph: { enabled: true, command: "codegraph" },
    },
    plugins: { enabled: true, autoload: true, autoInstall: false },
    memory: { embeddingDimensions: 4, enableSqliteVec: true, maxRetrievalTraces: 2000 },
    context: { recentTurns: 6, maxRecall: 6, maxContextChars: 90000, maxToolSteps: 4 },
  };
  mkdirSync(join(root, profileDir), { recursive: true });
  writeFileSync(join(root, configPath), JSON.stringify(config, null, 2), "utf8");
  return { root, configPath, profileDir };
}

/**
 * Creates a tiny project that the real model can inspect through actual tools.
 *
 * @param profile - Scenario profile that owns the fixture directory.
 * @returns Absolute path to the generated project.
 * @usage Project inspection is verified through tool outputs and brain audit rows.
 */
function createRealProject(profile: RealModelProfile): string {
  const projectDir = join(profile.root, profile.profileDir, "real-project");
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "flyflor-real-project", type: "module" }, null, 2), "utf8");
  writeFileSync(join(projectDir, "README.md"), "# flyflor-real-project\n\nReal model inspection fixture.\n", "utf8");
  writeFileSync(join(projectDir, "src/index.ts"), "export class RealProject { public readonly name = 'flyflor-real-project'; }\n", "utf8");
  return projectDir;
}

/**
 * Resolves the monthly brain database path for the real-model scenario.
 *
 * @param config - Config service with project-relative resolution.
 * @param profileDir - Scenario profile directory.
 * @returns Absolute path to the current monthly brain database.
 * @usage The scenario queries persisted audit rows as completion evidence.
 */
function brainDatabasePath(config: ConfigService, profileDir: string): string {
  const date = new Date();
  const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  return config.resolve(`${profileDir}/brain/${month}.brain.db`);
}

/**
 * Loads the ignored project `.env` file for real-model tests.
 *
 * @returns Nothing.
 * @usage Allows local DeepSeek credentials without requiring shell exports or committed secrets.
 */
function loadLocalEnv(): void {
  loadDotenv({ path: ".env", override: false, quiet: true });
}
