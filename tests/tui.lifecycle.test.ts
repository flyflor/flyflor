import { describe, expect, test } from "bun:test";
import { createTuiLifecycle, type TuiLifecycleProcess, type TuiLifecycleRenderer } from "../src/command/tui/lifecycle.ts";

class FakeRenderer implements TuiLifecycleRenderer {
    destroyCalls = 0;
    private destroyListener: (() => void) | undefined;

    destroy(): void {
        this.destroyCalls += 1;
    }

    once(event: "destroy", listener: () => void): void {
        expect(event).toBe("destroy");
        this.destroyListener = listener;
    }

    emitDestroy(): void {
        this.destroyListener?.();
    }
}

class FakeProcess implements TuiLifecycleProcess {
    readonly handlers = new Map<NodeJS.Signals, () => void>();
    readonly removed: NodeJS.Signals[] = [];

    once(event: NodeJS.Signals, listener: () => void): void {
        this.handlers.set(event, listener);
    }

    off(event: NodeJS.Signals, listener: () => void): void {
        if (this.handlers.get(event) === listener) {
            this.handlers.delete(event);
        }
        this.removed.push(event);
    }

    emit(event: NodeJS.Signals): void {
        this.handlers.get(event)?.();
    }
}

describe("TUI lifecycle", () => {
    test("destroy requests renderer teardown only once and resolves on renderer destroy", async () => {
        const renderer = new FakeRenderer();
        const proc = new FakeProcess();
        let cleanupCalls = 0;
        const lifecycle = createTuiLifecycle(renderer, {
            cleanup: () => {
                cleanupCalls += 1;
            },
            processLike: proc,
        });

        lifecycle.destroy();
        lifecycle.destroy();
        expect(renderer.destroyCalls).toBe(1);
        expect(lifecycle.isDestroyed()).toBe(false);

        renderer.emitDestroy();
        await lifecycle.waitForDestroy();

        expect(cleanupCalls).toBe(1);
        expect(lifecycle.isDestroyed()).toBe(true);
        expect(proc.handlers.size).toBe(0);
        expect(proc.removed).toEqual(["SIGINT", "SIGTERM"]);
    });

    test("signal handler uses the same one-shot destroy path", async () => {
        const renderer = new FakeRenderer();
        const proc = new FakeProcess();
        const lifecycle = createTuiLifecycle(renderer, { processLike: proc });

        proc.emit("SIGINT");
        proc.emit("SIGINT");
        expect(renderer.destroyCalls).toBe(1);

        renderer.emitDestroy();
        await lifecycle.waitForDestroy();

        proc.emit("SIGTERM");
        expect(renderer.destroyCalls).toBe(1);
    });
});
