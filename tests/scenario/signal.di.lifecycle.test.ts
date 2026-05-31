import { describe, expect, test } from "bun:test";
import { Component, createContainer, Inject, Module, Prompt, Subscribe } from "../../src/di";
import { SignalBus, type SignalLifecyclePayload } from "../../src/signal";

/**
 * Receives signal events through `@Subscribe` lifecycle wiring.
 *
 * @usage Scenario tests resolve this through the container to prove decorator metadata becomes runtime behavior.
 */
@Component()
class ScenarioSubscriber {
  public readonly events: unknown[] = [];

  /**
   * Records a scenario signal payload.
   *
   * @param payload - Payload emitted through SignalBus.
   * @returns Nothing.
   * @usage The container wires this method to `scenario.event`.
   */
  @Subscribe("scenario.event")
  public onScenarioEvent(payload: unknown): void {
    this.events.push(payload);
  }
}

/**
 * Receives property and prompt injections through standard decorator metadata.
 *
 * @usage Tests keep `@Inject` and `@Prompt` aligned with Bun's decorator runtime.
 */
@Component()
class ScenarioInjectedComponent {
  @Inject(SignalBus)
  public readonly signalBus!: SignalBus;

  @Prompt("./prompts/system.md")
  public readonly systemPrompt!: string;
}

/**
 * Assembles the signal lifecycle scenario providers.
 *
 * @usage Tests bootstrap this module through the project-owned DI container.
 */
@Module({
  providers: [SignalBus, ScenarioSubscriber, ScenarioInjectedComponent],
  exports: [SignalBus, ScenarioSubscriber, ScenarioInjectedComponent],
})
class ScenarioSignalModule {}

/**
 * Eagerly-bootstrapped guard responder used to prove bootstrap wiring and
 * require-responder semantics without an explicit `resolve` call.
 *
 * @usage The module lists this in `bootstrap`; the container must construct it
 * and attach its `guard.ask` handler during `createContainer`.
 */
@Component()
class ScenarioGuard {
  @Inject(SignalBus)
  public readonly signalBus!: SignalBus;

  public asks = 0;

  /**
   * Approves any guard ask it sees.
   *
   * @param _payload - Guard ask payload.
   * @returns Always true.
   * @usage Wired via `@Subscribe('guard.ask')` only when the guard is constructed.
   */
  @Subscribe("guard.ask")
  public onGuardAsk(_payload: unknown): boolean {
    this.asks += 1;
    return true;
  }
}

/**
 * Module that eagerly bootstraps {@link ScenarioGuard}.
 *
 * @usage Proves `bootstrap` providers are constructed and subscribed by `createContainer`.
 */
@Module({
  providers: [SignalBus, ScenarioGuard],
  exports: [SignalBus, ScenarioGuard],
  bootstrap: [ScenarioGuard],
})
class ScenarioGuardModule {}

describe("signal and DI lifecycle", () => {
  test("@Inject and @Prompt properties are resolved by the container", () => {
    const container = createContainer(ScenarioSignalModule);
    const injected = container.resolve(ScenarioInjectedComponent);

    expect(injected.signalBus).toBe(container.resolve(SignalBus));
    expect(injected.systemPrompt).toContain("Flyflor");
  });

  test("@Subscribe handlers are wired once by the container", async () => {
    const container = createContainer(ScenarioSignalModule);
    const subscriber = container.resolve(ScenarioSubscriber);
    const sameSubscriber = container.resolve(ScenarioSubscriber);
    const signalBus = container.resolve(SignalBus);

    expect(sameSubscriber).toBe(subscriber);
    await signalBus.emit("scenario.event", { value: "flyflor-signal" });
    expect(subscriber.events).toEqual([{ value: "flyflor-signal" }]);
  });

  test("bootstrap providers are constructed and subscribed without an explicit resolve", async () => {
    const container = createContainer(ScenarioGuardModule);
    const signalBus = container.resolve(SignalBus);
    // ScenarioGuard was never resolved by the test; bootstrap must have wired it.
    const approved = await signalBus.ask("guard.ask", { toolName: "write", turnId: "t1" });
    expect(approved).toBe(true);
    expect(container.resolve(ScenarioGuard).asks).toBe(1);
  });

  test("guard.* ask with no responder is audited via guard.unattended and honors policy", async () => {
    const strict = new SignalBus(false);
    const unattended: unknown[] = [];
    strict.subscribe("guard.unattended", (payload) => {
      unattended.push(payload);
    });

    // Strict mode (no auto-approve): unattended guard ask fails safe to deny.
    const denied = await strict.ask("guard.ask", { toolName: "shell", turnId: "t2" });
    expect(denied).toBe(false);
    expect(unattended).toHaveLength(1);
    expect((unattended[0] as { signal: string }).signal).toBe("guard.ask");

    // Dev mode (auto-approve): still audited as unattended, but approved.
    const dev = new SignalBus(true);
    const devUnattended: unknown[] = [];
    dev.subscribe("guard.unattended", (payload) => devUnattended.push(payload));
    const approved = await dev.ask("guard.ask", { toolName: "shell", turnId: "t3" });
    expect(approved).toBe(true);
    expect(devUnattended).toHaveLength(1);
  });

  test("SignalBus emits explicit lifecycle events", async () => {
    const signalBus = new SignalBus(true);
    const events: SignalLifecyclePayload[] = [];
    for (const state of ["complete", "final", "fail", "timeout"] as const) {
      signalBus.subscribe(`agent.turn.${state}`, async (payload: SignalLifecyclePayload) => {
        events.push(payload);
      });
    }

    await signalBus.complete("agent.turn", { turnId: "complete" });
    await signalBus.final("agent.turn", { turnId: "final" });
    await signalBus.fail("agent.turn", new Error("failed"), { turnId: "fail" });
    await signalBus.timeout("agent.turn", { turnId: "timeout" });

    expect(events.map((event) => event.state)).toEqual(["complete", "final", "fail", "timeout"]);
    expect(events.find((event) => event.state === "fail")?.error).toBe("failed");
  });
});
