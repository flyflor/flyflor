import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { config as loadDotenv } from "dotenv";
import { describe, expect, test } from "bun:test";
import { ConfigService } from "../../src/config/config.service";
import { ContextBuilderService } from "../../src/context";
import { AgentRuntimeService } from "../../src/kernel";
import { MemoryComponent } from "../../src/memory";
import { SignalBus } from "../../src/signal";

/**
 * Describes one event observed during the DeepSeek inner test.
 *
 * @property type - SignalBus event type.
 * @property payload - Event payload emitted by runtime or tools.
 * @usage The inner test inspects events to prove tool exploration happened.
 */
interface ObservedEvent {
  readonly type: string;
  readonly payload: unknown;
}

/**
 * Describes one isolated DeepSeek scenario profile.
 *
 * @property root - Repository root used by ConfigService.
 * @property configPath - Project-relative config path for this scenario.
 * @property profileDir - Project-relative runtime profile directory.
 * @usage DeepSeek inner tests keep brain, memory, tools, and plugin state isolated from normal runtime.
 */
interface DeepSeekInnerProfile {
  readonly root: string;
  readonly configPath: string;
  readonly profileDir: string;
}

loadLocalEnv();
const innerConfig = new ConfigService();
const hasDeepSeekCredential = Boolean(innerConfig.getProvider("deepseek")?.api_key);

describe("DeepSeek inner scenario", () => {
  test("uses real model with project inspection when credentials are configured", async () => {
    expect(hasDeepSeekCredential).toBe(true);
    const profile = createDeepSeekInnerProfile(`deepseek-inner-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    const config = new ConfigService(profile.root, profile.configPath);
    const targetProject = createInnerProject(profile);
    expect(config.getConfig().model.provider).toBe("deepseek");
    expect(existsSync(targetProject)).toBe(true);
    expect(config.getProvider("deepseek")?.api_key.length ?? 0).toBeGreaterThan(0);

    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const events: ObservedEvent[] = [];
    for (const type of ["tool.call", "tool.result", "memory.recall", "chat.final"]) {
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
    const result = await runtime.runTurn({
      conversationId: `inner-${Date.now()}`,
      content: `仔细阅读这个项目 ${targetProject} 说说你的看法`,
    });
    expect(result.toolResults.length).toBeGreaterThanOrEqual(4);
    expect(events.filter((event) => event.type === "tool.call").length).toBeGreaterThanOrEqual(4);
    expect(result.context.recall.length).toBe(0);
    expect(result.assistantMessage.length).toBeGreaterThan(20);
    expect(result.toolResults.map((toolResult) => toolResult.output).join("\n")).toContain("flyflor-inner-real-project");
    expect(result.assistantMessage).not.toContain("已结合本地记忆处理");
  }, 120_000);
});

/**
 * Creates an isolated real-model config with bounded output tokens.
 *
 * @param name - Unique scenario profile name.
 * @returns Scenario profile paths.
 * @usage Real-model smoke tests must not mutate normal `.config/memory` or depend on root output budgets.
 */
function createDeepSeekInnerProfile(name: string): DeepSeekInnerProfile {
  const root = process.cwd();
  const profileDir = `./.config/runtime/scenarios/${name}`;
  const configPath = `${profileDir}/config.jsonc`;
  const rootProvider = innerConfig.getProvider("deepseek");
  const activeModel = innerConfig.getActiveModelName();
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
      default: activeModel,
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
        base_url: rootProvider?.base_url ?? "https://api.deepseek.com",
        api_key_env: "DEEPSEEK_API_KEY",
        api_key: "",
        request_timeout_seconds: 120,
        stale_timeout_seconds: 120,
        models: {
          [activeModel]: {
            context_length: rootProvider?.models[activeModel]?.context_length ?? null,
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
    context: { recentTurns: 4, maxRecall: 4, maxContextChars: 30000, maxToolSteps: 3 },
  };
  mkdirSync(join(root, profileDir), { recursive: true });
  writeFileSync(join(root, configPath), JSON.stringify(config, null, 2), "utf8");
  return { root, configPath, profileDir };
}

/**
 * Creates a small project fixture for real-model inspection.
 *
 * @param profile - Scenario profile that owns the fixture directory.
 * @returns Absolute project path.
 * @usage Keeps the real-model smoke focused on agent behavior instead of an external repository's size.
 */
function createInnerProject(profile: DeepSeekInnerProfile): string {
  const projectDir = join(profile.root, profile.profileDir, "inner-project");
  mkdirSync(join(projectDir, "src"), { recursive: true });
  writeFileSync(join(projectDir, "package.json"), JSON.stringify({ name: "flyflor-inner-real-project", type: "module" }, null, 2), "utf8");
  writeFileSync(join(projectDir, "README.md"), "# flyflor-inner-real-project\n\nDeepSeek inner scenario fixture.\n", "utf8");
  writeFileSync(join(projectDir, "src/index.ts"), "export class InnerRealProject { public readonly name = 'flyflor-inner-real-project'; }\n", "utf8");
  return projectDir;
}

/**
 * Loads the ignored project `.env` file for inner tests.
 *
 * @returns Nothing.
 * @usage Allows `.env` to provide `DEEPSEEK_API_KEY` without committing secrets.
 */
function loadLocalEnv(): void {
  loadDotenv({ path: ".env", override: false, quiet: true });
}
