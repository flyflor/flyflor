import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "bun:test";
import { ConfigService } from "../../src/config/config.service";
import { MemoryComponent } from "../../src/memory";

const rootMemoryConfig = new ConfigService();
const rootDeepSeekProvider = rootMemoryConfig.getProvider("deepseek");
const memoryScenarioModelName = rootMemoryConfig.getActiveModelName();

/**
 * Describes an isolated memory scenario profile.
 *
 * @property root - Repository root used by ConfigService.
 * @property configPath - Project-relative config path for this scenario.
 * @property profileDir - Project-relative runtime profile directory.
 * @usage Memory-vector-tree tests use this profile to avoid normal runtime state.
 */
interface MemoryScenarioProfile {
  readonly root: string;
  readonly configPath: string;
  readonly profileDir: string;
}

describe("memory vector tree recall", () => {
  test("returns current fact and excludes stale unrelated project fact", () => {
    const profile = createMemoryScenarioProfile(`memory-tree-${Date.now()}-${Math.random().toString(16).slice(2)}`);
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
    const currentFact = memory.upsertFact({
      namespace: "active-project",
      subject: "项目代号",
      predicate: "is",
      object: "flyflor-tree-current",
      sourceKind: "chunk",
      sourceId: String(currentChunk.id),
    });
    memory.upsertClaim({
      namespace: "active-project",
      claim: "Tree recall should prefer structured current facts.",
      status: "confirmed",
      sourceKind: "chunk",
      sourceId: String(currentChunk.id),
    });
    memory.upsertDecision({
      namespace: "active-project",
      decision: "Use tree recall for memory questions",
      rationale: "Structured facts should outrank stale unrelated chunks.",
      sourceKind: "chunk",
      sourceId: String(currentChunk.id),
    });
    memory.upsertTask({
      namespace: "active-project",
      title: "Close memory vector tree recall loop",
      status: "in_progress",
      sourceKind: "chunk",
      sourceId: String(currentChunk.id),
    });
    memory.upsertArtifact({
      kind: "tool-output",
      path: `${profile.profileDir}/memory/artifacts/current.txt`,
      sourceKind: "chunk",
      sourceId: String(currentChunk.id),
      bytes: 42,
      metadata: { label: "active-project evidence" },
    });

    const tree = memory.treeRecall("active-project 当前项目代号是什么？", 1, { conversationId: "tree-recall" });
    const legacyRecall = memory.recall("active-project 当前项目代号是什么？", 1, { trace: false });
    expect(tree.facts.map((fact) => fact.object)).toEqual(["flyflor-tree-current"]);
    expect(legacyRecall.map((item) => item.chunk.content).join("\n")).toContain("flyflor-tree-current");
    expect(tree.chunks.map((item) => item.chunk.content).join("\n")).toContain("flyflor-tree-current");
    expect(tree.chunks.map((item) => item.chunk.content).join("\n")).not.toContain("flyflor-archive-stale");
    expect(tree.entities.map((entity) => entity.name)).toContain("active-project:项目代号");
    expect(tree.relations.map((relation) => relation.kind)).toContain("evidence");
    expect(tree.claims.map((claim) => claim.claim)).toContain("Tree recall should prefer structured current facts.");
    expect(tree.decisions.map((decision) => decision.decision)).toContain("Use tree recall for memory questions");
    expect(tree.tasks.map((task) => task.title)).toContain("Close memory vector tree recall loop");
    expect(tree.artifacts.map((artifact) => artifact.path)).toContain(`${profile.profileDir}/memory/artifacts/current.txt`);

    const trace = memory.recentRetrievalTraces(1, "tree-recall")[0];
    expect(trace?.strategy).toContain("tree");
    expect(trace?.resultIds).toContain(`fact:${currentFact.id}`);
    expect(trace?.diagnostics).toContain("graph-neighborhood");
  });
});

/**
 * Creates a project-local isolated memory scenario config.
 *
 * @param name - Unique scenario profile name.
 * @returns Scenario profile paths.
 * @usage Tests call this before constructing ConfigService.
 */
function createMemoryScenarioProfile(name: string): MemoryScenarioProfile {
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
      externalPluginsDir: "./plugins",
      pluginStateDir: `${profileDir}/plugins`,
      socketTestPage: "./.config/web/socket-test.html",
      runtimeDir: `${profileDir}/runtime`,
    },
    runtime: { autoApproveGuards: true },
    socket: { host: "127.0.0.1", port: 0 },
    prompts: { system: "./prompts/system.md" },
    model: {
      default: memoryScenarioModelName,
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
          [memoryScenarioModelName]: {
            context_length: rootDeepSeekProvider?.models[memoryScenarioModelName]?.context_length ?? null,
            max_tokens: 512,
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
    context: { recentTurns: 6, maxRecall: 6 },
  };
  mkdirSync(dirname(join(root, configPath)), { recursive: true });
  writeFileSync(join(root, configPath), JSON.stringify(config, null, 2), "utf8");
  return { root, configPath, profileDir };
}
