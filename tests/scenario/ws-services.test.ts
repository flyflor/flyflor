import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ConfigService } from "../../src/config/config.service";
import { MemoryComponent } from "../../src/memory";
import { SignalBus } from "../../src/signal";
import { SandboxGuard } from "../../src/sandbox";
import { WorkerService } from "../../src/worker/worker.service";
import { ScopeStore } from "../../src/scope/scope.store.component";
import { ScopeService } from "../../src/scope/scope.service";
import type { CrystalCandidate } from "../../src/crystal/crystal.types";
import { CrystalService } from "../../src/crystal/crystal.service";
import { ForgettingService } from "../../src/forgetting/forgetting.service";

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

// ---------------------------------------------------------------------------
// Mock CrystalStore (avoids sqlite-vec dynamic-extension-loading requirement
// that is unavailable in the bun:test runtime).
// ---------------------------------------------------------------------------

/** In-memory replacement for CrystalStore used by CrystalService + ForgettingService tests. */
function createMockCrystalStore() {
  const candidates = new Map<string, CrystalCandidate>();
  let nextId = 0;

  return {
    createCandidate(input: { readonly askContext: string; readonly resolution: string }): CrystalCandidate {
      const candidateId = `mock-candidate-${++nextId}`;
      const patternKey = createHash("sha256")
        .update(`${input.askContext}\0${input.resolution}`)
        .digest("hex");
      const candidate: CrystalCandidate = {
        candidateId,
        patternKey,
        askContext: input.askContext,
        resolution: input.resolution,
        hitCount: 1,
      };
      candidates.set(patternKey, candidate);
      return candidate;
    },

    findCandidateByPattern(patternKey: string): CrystalCandidate | null {
      return candidates.get(patternKey) ?? null;
    },

    reinforceCandidate(patternKey: string): CrystalCandidate | null {
      const existing = candidates.get(patternKey);
      if (!existing) return null;
      const reinforced: CrystalCandidate = { ...existing, hitCount: existing.hitCount + 1 };
      candidates.set(patternKey, reinforced);
      return reinforced;
    },

    logAsk(_ask: string, _answer: string, _turnId: string): void {
      // no-op for test isolation
    },

    listActiveGems(): readonly never[] {
      return [];
    },

    updateGemConfidence(_gemId: string, _confidence: number): void {
      // no-op
    },

    markGemStale(_gemId: string): void {
      // no-op
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ws-services scenario", () => {
  let profile: ScenarioProfile;

  beforeEach(() => {
    profile = createScenarioProfile(
      `ws-services-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    );
  });

  afterEach(() => {
    // Scenario output intentionally remains under .config/runtime/scenarios for review.
  });

  // ---------------------------------------------------------------------------
  // SandboxGuard risk classification
  // ---------------------------------------------------------------------------

  describe("SandboxGuard risk classification", () => {
    test("classifies shell tool as high risk and denies when auto-approve is off", () => {
      const noAutoProfile = createScenarioProfile(
        `sandbox-noauto-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        { runtime: { autoApproveGuards: false } },
      );
      const config = new ConfigService(noAutoProfile.root, noAutoProfile.configPath);
      const signalBus = new SignalBus(false);
      const memory = new MemoryComponent(config);
      const guard = new SandboxGuard(signalBus, config, memory);

      const result = guard.inspect({ toolName: "shell", toolInput: { command: "echo test" } });
      expect(result.riskLevel).toBe("high");
      expect(result.riskScore).toBe(0.9);
      expect(result.anomalyScore).toBe(0);
      // "shell" is high risk but anomalyScore (0) is not > 0.5, so it falls
      // through to the medium escalation path: approved=false.
      expect(result.approved).toBe(false);
      expect(result.reason).toContain("medium risk tool requires escalation");
    });

    test("classifies read tool as low risk (auto-approved)", () => {
      const noAutoProfile = createScenarioProfile(
        `sandbox-read-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        { runtime: { autoApproveGuards: false } },
      );
      const config = new ConfigService(noAutoProfile.root, noAutoProfile.configPath);
      const signalBus = new SignalBus(false);
      const memory = new MemoryComponent(config);
      const guard = new SandboxGuard(signalBus, config, memory);

      const result = guard.inspect({ toolName: "read" });
      expect(result.riskLevel).toBe("low");
      expect(result.riskScore).toBe(0.1);
      expect(result.approved).toBe(true);
      expect(result.reason).toContain("low risk tool");
    });

    test("classifies write tool as medium risk", () => {
      const noAutoProfile = createScenarioProfile(
        `sandbox-write-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        { runtime: { autoApproveGuards: false } },
      );
      const config = new ConfigService(noAutoProfile.root, noAutoProfile.configPath);
      const signalBus = new SignalBus(false);
      const memory = new MemoryComponent(config);
      const guard = new SandboxGuard(signalBus, config, memory);

      const result = guard.inspect({ toolName: "write" });
      expect(result.riskLevel).toBe("medium");
      expect(result.riskScore).toBe(0.5);
      expect(result.approved).toBe(false);
      expect(result.reason).toContain("medium risk tool requires escalation");
    });

    test("autoApproveGuards=true bypasses all checks for shell tool", () => {
      // The scenario default has autoApproveGuards: true.
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const guard = new SandboxGuard(signalBus, config, memory);

      const result = guard.inspect({ toolName: "shell" });
      expect(result.riskLevel).toBe("high");
      expect(result.approved).toBe(true);
      expect(result.reason).toBe("auto-approve enabled in runtime config");
    });

    test("autoApproveGuards=true also approves unknown tools", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const guard = new SandboxGuard(signalBus, config, memory);

      // Unknown tools default to "medium" risk, but auto-approve overrides.
      const result = guard.inspect({ toolName: "unknown_exotic_tool" });
      expect(result.riskLevel).toBe("medium");
      expect(result.approved).toBe(true);
    });

    test("returns correct risk levels for known tool families", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const guard = new SandboxGuard(signalBus, config, memory);

      // "shell" has riskLevel "high" in tool metadata.
      const bash = guard.inspect({ toolName: "shell" });
      expect(bash.riskLevel).toBe("high");
      expect(bash.riskScore).toBe(0.9);

      // "edit" has riskLevel "medium" in tool metadata.
      const edit = guard.inspect({ toolName: "edit" });
      expect(edit.riskLevel).toBe("medium");
      expect(edit.riskScore).toBe(0.5);

      // "grep" has riskLevel "low" in tool metadata.
      const grep = guard.inspect({ toolName: "grep" });
      expect(grep.riskLevel).toBe("low");
      expect(grep.riskScore).toBe(0.1);

      // "codegraph" is not registered in this test ToolRegistry, defaults to medium.
      const cg = guard.inspect({ toolName: "codegraph" });
      expect(cg.riskLevel).toBe("medium");

      // "multi_edit" has riskLevel "medium" in tool metadata.
      const multi = guard.inspect({ toolName: "multi_edit" });
      expect(multi.riskLevel).toBe("medium");
    });
  });

  // ---------------------------------------------------------------------------
  // WorkerService spawn and queue
  // ---------------------------------------------------------------------------

  describe("WorkerService spawn and queue", () => {
    test("initial state has zero active and zero queued", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const worker = new WorkerService(
        config,
        signalBus,
        undefined as unknown as MemoryComponent,
        undefined as any,
        undefined as any,
        undefined as any,
        undefined,
      );

      expect(worker.getActiveCount()).toBe(0);
      expect(worker.getQueuedCount()).toBe(0);
    });

    test("queues workers when maxConcurrent is zero", async () => {
      const queueProfile = createScenarioProfile(
        `worker-queue-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        { agents: { defaults: { maxConcurrent: 0 } } },
      );
      const config = new ConfigService(queueProfile.root, queueProfile.configPath);
      const signalBus = new SignalBus(true);

      const queued: unknown[] = [];
      signalBus.subscribe("worker.queued", async (payload) => {
        queued.push(payload);
      });

      const worker = new WorkerService(
        config,
        signalBus,
        undefined as unknown as MemoryComponent,
        undefined as any,
        undefined as any,
        undefined as any,
        undefined,
      );

      await worker.handleSpawn({
        workerId: "w-queue-1",
        agentProfile: "general",
        prompt: "task one",
        parentTurnId: "turn-1",
        parentConversationId: "conv-1",
      });

      expect(worker.getQueuedCount()).toBe(1);
      expect(worker.getActiveCount()).toBe(0);
      expect(queued).toHaveLength(1);
      expect(queued[0]).toMatchObject({ workerId: "w-queue-1", position: 1 });
    });

    test("tracks multiple queued workers in order", async () => {
      const multiProfile = createScenarioProfile(
        `worker-multi-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        { agents: { defaults: { maxConcurrent: 0 } } },
      );
      const config = new ConfigService(multiProfile.root, multiProfile.configPath);
      const signalBus = new SignalBus(true);

      const queued: unknown[] = [];
      signalBus.subscribe("worker.queued", async (payload) => {
        queued.push(payload);
      });

      const worker = new WorkerService(
        config,
        signalBus,
        undefined as unknown as MemoryComponent,
        undefined as any,
        undefined as any,
        undefined as any,
        undefined,
      );

      await worker.handleSpawn({
        workerId: "w-a",
        agentProfile: "explore",
        prompt: "task A",
        parentTurnId: "turn-1",
        parentConversationId: "conv-1",
      });
      await worker.handleSpawn({
        workerId: "w-b",
        agentProfile: "explore",
        prompt: "task B",
        parentTurnId: "turn-1",
        parentConversationId: "conv-1",
      });
      await worker.handleSpawn({
        workerId: "w-c",
        agentProfile: "explore",
        prompt: "task C",
        parentTurnId: "turn-1",
        parentConversationId: "conv-1",
      });

      expect(worker.getQueuedCount()).toBe(3);
      expect(queued).toHaveLength(3);
      expect(queued[0]).toMatchObject({ workerId: "w-a", position: 1 });
      expect(queued[1]).toMatchObject({ workerId: "w-b", position: 2 });
      expect(queued[2]).toMatchObject({ workerId: "w-c", position: 3 });
    });

    test("cancels a queued worker by id", async () => {
      const cancelProfile = createScenarioProfile(
        `worker-cancel-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        { agents: { defaults: { maxConcurrent: 0 } } },
      );
      const config = new ConfigService(cancelProfile.root, cancelProfile.configPath);
      const signalBus = new SignalBus(true);
      const worker = new WorkerService(
        config,
        signalBus,
        undefined as unknown as MemoryComponent,
        undefined as any,
        undefined as any,
        undefined as any,
        undefined,
      );

      await worker.handleSpawn({
        workerId: "w-cancel",
        agentProfile: "general",
        prompt: "task to cancel",
        parentTurnId: "turn-1",
        parentConversationId: "conv-1",
      });
      await worker.handleSpawn({
        workerId: "w-keep",
        agentProfile: "general",
        prompt: "task to keep",
        parentTurnId: "turn-1",
        parentConversationId: "conv-1",
      });
      expect(worker.getQueuedCount()).toBe(2);

      const cancelled = worker.cancel("w-cancel");
      expect(cancelled).toBe(true);
      expect(worker.getQueuedCount()).toBe(1);
    });

    test("cancelling non-existent worker returns false", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const worker = new WorkerService(
        config,
        signalBus,
        undefined as unknown as MemoryComponent,
        undefined as any,
        undefined as any,
        undefined as any,
        undefined,
      );

      expect(worker.cancel("nonexistent")).toBe(false);
      expect(worker.getQueuedCount()).toBe(0);
      expect(worker.getActiveCount()).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // ScopeService keyword detection
  // ---------------------------------------------------------------------------

  describe("ScopeService keyword detection", () => {
    test("detects keywords in user text and emits scope activation signals", async () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      // enableSqliteVec is false, so ScopeStore won't try to load the extension.
      // The vec0 CREATE in scope-schema.sql is silently skipped via IF NOT EXISTS.
      const scopeStore = new ScopeStore(config, undefined, memory);

      scopeStore.createScope({
        name: "Flyflor Project",
        codename: "flyflor",
        namespace: "flyflor",
        keywords: ["flyflor", "project-alpha"],
        constitution: "# Flyflor Constitution\n\nProject scope for Flyflor development.",
      });

      const scopeService = new ScopeService(scopeStore, memory, signalBus, config);

      const activated: unknown[] = [];
      const detected: unknown[] = [];
      const recallStarted: unknown[] = [];
      signalBus.subscribe("scope.activated", async (payload) => {
        activated.push(payload);
      });
      signalBus.subscribe("scope.detected", async (payload) => {
        detected.push(payload);
      });
      signalBus.subscribe("scope.recall_mode.started", async (payload) => {
        recallStarted.push(payload);
      });

      await scopeService.detectAndActivate("conv-1", "turn-1", "let's discuss the flyflor project");

      expect(activated).toHaveLength(1);
      expect(activated[0]).toMatchObject({
        conversationId: "conv-1",
        scopeName: "Flyflor Project",
      });

      expect(detected).toHaveLength(1);
      expect(detected[0]).toMatchObject({
        conversationId: "conv-1",
        turnId: "turn-1",
      });
      const detectedPayload = detected[0] as { keywords: readonly string[] };
      expect(detectedPayload.keywords).toContain("flyflor");

      expect(recallStarted).toHaveLength(1);
    });

    test("does not activate scope when no keywords match", async () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const scopeStore = new ScopeStore(config, undefined, memory);

      scopeStore.createScope({
        name: "Test Scope",
        codename: "test-scope",
        namespace: "test",
        keywords: ["flyflor"],
        constitution: "# Test",
      });

      const scopeService = new ScopeService(scopeStore, memory, signalBus, config);

      const activated: unknown[] = [];
      signalBus.subscribe("scope.activated", async (payload) => {
        activated.push(payload);
      });

      await scopeService.detectAndActivate("conv-1", "turn-1", "completely unrelated text without any keywords");
      expect(activated).toHaveLength(0);
    });

    test("keyword matching is case-insensitive", async () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const scopeStore = new ScopeStore(config, undefined, memory);

      scopeStore.createScope({
        name: "Case Test",
        codename: "case-test",
        namespace: "test",
        keywords: ["Flyflor", "PROJECT"],
        constitution: "# Case Test",
      });

      const scopeService = new ScopeService(scopeStore, memory, signalBus, config);

      const activated: unknown[] = [];
      signalBus.subscribe("scope.activated", async (payload) => {
        activated.push(payload);
      });

      await scopeService.detectAndActivate("conv-1", "turn-1", "talking about FLYFLOR in lowercase");
      expect(activated).toHaveLength(1);
    });

    test("detectKeywords returns matched scopeIds and keywords", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const memory = new MemoryComponent(config);
      const scopeStore = new ScopeStore(config, undefined, memory);

      const scope1 = scopeStore.createScope({
        name: "Scope One",
        codename: "scope-one",
        namespace: "one",
        keywords: ["alpha", "beta"],
        constitution: "# One",
      });
      const scope2 = scopeStore.createScope({
        name: "Scope Two",
        codename: "scope-two",
        namespace: "two",
        keywords: ["gamma", "beta"],
        constitution: "# Two",
      });

      // Text matching "alpha" returns only scope-one.
      const matchAlpha = scopeStore.detectKeywords("this is about alpha testing");
      expect(matchAlpha).toHaveLength(1);
      expect(matchAlpha[0]!.scopeId).toBe(scope1.id);
      expect(matchAlpha[0]!.codename).toBe("scope-one");
      expect(matchAlpha[0]!.matchedKeywords).toEqual(["alpha"]);

      // Text matching "beta" returns both scopes.
      const matchBeta = scopeStore.detectKeywords("beta is shared");
      expect(matchBeta).toHaveLength(2);
      expect(matchBeta.map((m) => m.codename).sort()).toEqual(["scope-one", "scope-two"]);

      // Text matching nothing returns empty.
      const matchNone = scopeStore.detectKeywords("nothing here");
      expect(matchNone).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // CrystalService ASK creation
  // ---------------------------------------------------------------------------

  describe("CrystalService ASK creation", () => {
    test("createAsk returns a valid ASK payload with unique askId", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const crystal = new CrystalService();
      crystal.memoryComponent = memory;
      crystal.signalBus = signalBus;
      crystal.configService = config;
      // crystalStore is not needed for createAsk — it only touches the in-memory
      // pendingAsks map.

      const ask1 = crystal.createAsk("sandbox:shell high risk", [
        {
          id: "q1",
          question: "Allow shell execution?",
          options: [
            { id: "opt1", text: "Yes, allow this time", recommended: true },
            { id: "opt2", text: "No, deny execution", recommended: false },
          ],
        },
      ]);

      expect(ask1.askId).toBeTruthy();
      expect(ask1.askId).toHaveLength(36); // UUID v4
      expect(ask1.questions).toHaveLength(1);
      expect(ask1.questions[0]!.question).toBe("Allow shell execution?");
      expect(ask1.questions[0]!.options).toHaveLength(2);

      // Each ASK gets a unique id.
      const ask2 = crystal.createAsk("another context", [
        { id: "q1", question: "Proceed?", options: [{ id: "opt1", text: "Yes", recommended: true }] },
      ]);
      expect(ask2.askId).not.toBe(ask1.askId);
    });

    test("forms a crystal candidate from ASK + answer", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const crystal = new CrystalService();
      crystal.crystalStore = mockStore as any;
      crystal.memoryComponent = memory;
      crystal.signalBus = signalBus;
      crystal.configService = config;

      const ask = crystal.createAsk("tool:shell risk:high", [
        {
          id: "q1",
          question: "Allow shell execution?",
          options: [{ id: "opt1", text: "Yes, allow this time", recommended: true }],
        },
      ]);

      const candidate = crystal.processAnswer({
        askId: ask.askId,
        questionId: "q1",
        selectedOptionId: "opt1",
        answeredAt: Date.now(),
      });

      expect(candidate).not.toBeNull();
      expect(candidate!.hitCount).toBe(1);
      expect(candidate!.resolution).toBe("Allow shell execution?: Yes, allow this time");
      expect(candidate!.askContext).toBe("tool:shell risk:high");
      expect(candidate!.patternKey).toBeTruthy();
      expect(candidate!.patternKey).toHaveLength(64); // sha256 hex
      expect(candidate!.candidateId).toBeTruthy();
    });

    test("repeated pattern hits increment hit_count", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const crystal = new CrystalService();
      crystal.crystalStore = mockStore as any;
      crystal.memoryComponent = memory;
      crystal.signalBus = signalBus;
      crystal.configService = config;

      const ask = crystal.createAsk("tool:shell risk:high", [
        {
          id: "q1",
          question: "Allow shell execution?",
          options: [{ id: "opt1", text: "Yes, allow this time", recommended: true }],
        },
      ]);

      const answer = {
        askId: ask.askId,
        questionId: "q1",
        selectedOptionId: "opt1",
        answeredAt: Date.now(),
      };

      // First hit creates a new candidate.
      const c1 = crystal.processAnswer(answer);
      expect(c1).not.toBeNull();
      expect(c1!.hitCount).toBe(1);

      // Second hit reinforces the same candidate (same askId, context, resolution).
      const c2 = crystal.processAnswer(answer);
      expect(c2).not.toBeNull();
      expect(c2!.hitCount).toBe(2);
      expect(c2!.candidateId).toBe(c1!.candidateId);
      expect(c2!.patternKey).toBe(c1!.patternKey);
    });

    test("processAnswer returns null for unknown askId", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const crystal = new CrystalService();
      crystal.crystalStore = mockStore as any;
      crystal.memoryComponent = memory;
      crystal.signalBus = signalBus;
      crystal.configService = config;

      const result = crystal.processAnswer({
        askId: "00000000-0000-0000-0000-000000000000",
        questionId: "q1",
        selectedOptionId: "opt1",
        answeredAt: Date.now(),
      });
      expect(result).toBeNull();
    });

    test("processAnswer returns null for unknown question id", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const crystal = new CrystalService();
      crystal.crystalStore = mockStore as any;
      crystal.memoryComponent = memory;
      crystal.signalBus = signalBus;
      crystal.configService = config;

      const ask = crystal.createAsk("tool:shell risk:high", [
        {
          id: "q1",
          question: "Allow shell execution?",
          options: [{ id: "opt1", text: "Yes", recommended: true }],
        },
      ]);

      const result = crystal.processAnswer({
        askId: ask.askId,
        questionId: "q-nonexistent",
        selectedOptionId: "opt1",
        answeredAt: Date.now(),
      });
      expect(result).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // ForgettingService decay calculation
  // ---------------------------------------------------------------------------

  describe("ForgettingService decay calculation", () => {
    test("Ebbinghaus decay produces expected retention values", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const forgetting = new ForgettingService();
      (forgetting as unknown as Record<string, unknown>).memory = memory;
      (forgetting as unknown as Record<string, unknown>).signalBus = signalBus;
      (forgetting as unknown as Record<string, unknown>).config = config;
      (forgetting as unknown as Record<string, unknown>).crystalStore = mockStore;

      // 0 hours: exp(0) = 1 (perfect retention).
      expect(forgetting.applyEbbinghausDecay(0)).toBe(1);

      // 1 hour: exp(-1/24) ≈ 0.959.
      expect(forgetting.applyEbbinghausDecay(1)).toBeCloseTo(0.959, 2);

      // 12 hours: exp(-12/24) = exp(-0.5) ≈ 0.607.
      expect(forgetting.applyEbbinghausDecay(12)).toBeCloseTo(0.607, 2);

      // 24 hours: exp(-24/24) = exp(-1) ≈ 0.368.
      expect(forgetting.applyEbbinghausDecay(24)).toBeCloseTo(0.368, 2);

      // 48 hours: exp(-48/24) = exp(-2) ≈ 0.135.
      expect(forgetting.applyEbbinghausDecay(48)).toBeCloseTo(0.135, 2);

      // Negative age is clamped to 0, so exp(0) = 1.
      expect(forgetting.applyEbbinghausDecay(-5)).toBe(1);
    });

    test("emits cycle start and completion signals", async () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const forgetting = new ForgettingService();
      (forgetting as unknown as Record<string, unknown>).memory = memory;
      (forgetting as unknown as Record<string, unknown>).signalBus = signalBus;
      (forgetting as unknown as Record<string, unknown>).config = config;
      (forgetting as unknown as Record<string, unknown>).crystalStore = mockStore;

      const started: unknown[] = [];
      const completed: unknown[] = [];
      signalBus.subscribe("forgetting.cycle.started", async (payload) => {
        started.push(payload);
      });
      signalBus.subscribe("forgetting.cycle.completed", async (payload) => {
        completed.push(payload);
      });

      const result = await forgetting.startCycle("timer");

      expect(started).toHaveLength(1);
      expect(started[0]).toMatchObject({ triggeredBy: "timer" });
      const startedPayload = started[0] as { cycleId: string; startedAt: number };
      expect(startedPayload.cycleId).toBeTruthy();
      expect(typeof startedPayload.startedAt).toBe("number");

      expect(completed).toHaveLength(1);
      const completedPayload = completed[0] as { cycleId: string; elapsedMs: number };
      expect(completedPayload.cycleId).toBe(startedPayload.cycleId);

      // On an empty memory store, all phase counts should be zero.
      expect(result).toMatchObject({
        cycleId: startedPayload.cycleId,
        chunksCompacted: 0,
        chunksFaded: 0,
        factsAged: 0,
        gemsDrifted: 0,
      });
      expect(typeof result.elapsedMs).toBe("number");
      expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
    });

    test("startCycle with different triggers emits correct trigger type", async () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const forgetting = new ForgettingService();
      (forgetting as unknown as Record<string, unknown>).memory = memory;
      (forgetting as unknown as Record<string, unknown>).signalBus = signalBus;
      (forgetting as unknown as Record<string, unknown>).config = config;
      (forgetting as unknown as Record<string, unknown>).crystalStore = mockStore;

      const started: unknown[] = [];
      signalBus.subscribe("forgetting.cycle.started", async (payload) => {
        started.push(payload);
      });

      await forgetting.startCycle("recovery");
      expect(started).toHaveLength(1);
      expect(started[0]).toMatchObject({ triggeredBy: "recovery" });

      await forgetting.startCycle("compaction");
      expect(started).toHaveLength(2);
      expect(started[1]).toMatchObject({ triggeredBy: "compaction" });
    });

    test("startPeriodicCycle and stopPeriodicCycle are idempotent", () => {
      const config = new ConfigService(profile.root, profile.configPath);
      const signalBus = new SignalBus(true);
      const memory = new MemoryComponent(config);
      const mockStore = createMockCrystalStore();
      const forgetting = new ForgettingService();
      (forgetting as unknown as Record<string, unknown>).memory = memory;
      (forgetting as unknown as Record<string, unknown>).signalBus = signalBus;
      (forgetting as unknown as Record<string, unknown>).config = config;
      (forgetting as unknown as Record<string, unknown>).crystalStore = mockStore;

      // Should not throw on first call.
      forgetting.startPeriodicCycle();
      // Second call is a no-op (cycleTimer already set).
      forgetting.startPeriodicCycle();
      // Stop should clear the timer.
      forgetting.stopPeriodicCycle();
      // Stopping again should be a no-op.
      forgetting.stopPeriodicCycle();
    });
  });
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a project-local isolated scenario config.
 *
 * Each test gets unique paths under `.config/runtime/scenarios/<name>/`
 * so that databases, memory files, and plugin state never collide
 * across tests or with normal development runtime.
 *
 * @param name - Unique scenario profile name.
 * @param overrides - Optional config overrides merged on top of defaults.
 * @returns Scenario profile paths.
 * @usage Tests call this before constructing ConfigService.
 */
function createScenarioProfile(
  name: string,
  overrides: Record<string, unknown> = {},
): ScenarioProfile {
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
      scopeDir: `${profileDir}/scope`,
      crystalDb: `${profileDir}/crystal/crystal.db`,
    },
    runtime: { autoApproveGuards: true },
    socket: { host: "127.0.0.1", port: 0 },
    prompts: { system: "./prompts/system.md" },
    model: {
      default: "deepseek-v4-flash",
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
        base_url: "https://api.deepseek.com",
        api_key_env: "DEEPSEEK_API_KEY",
        api_key: "",
        request_timeout_seconds: 300,
        stale_timeout_seconds: 900,
        models: {
          "deepseek-v4-flash": {
            context_length: null,
            max_tokens: 512,
          },
        },
      },
    },
    tools: {
      rtk: { enabled: true, command: "rtk" },
      codegraph: { enabled: true, command: "codegraph" },
    },
    // Disable sqlite-vec so MemoryComponent + ScopeStore construct without
    // calling db.loadExtension, which is unsupported in the bun:test runtime.
    // ScopeStore's vec0 CREATE is silently skipped via IF NOT EXISTS.
    memory: { embeddingDimensions: 4, enableSqliteVec: false },
    context: { recentTurns: 6, maxRecall: 6 },
    ...overrides,
  };
  mkdirSync(dirname(join(root, configPath)), { recursive: true });
  writeFileSync(join(root, configPath), JSON.stringify(config, null, 2), "utf8");
  return { root, configPath, profileDir };
}
