/**
 * Shared TUI lifecycle guard.
 *
 * OpenTUI renderers emit `destroy` after teardown. Callers must not call
 * `renderer.destroy()` again from that event, otherwise terminal shutdown can
 * re-enter and leave tests or CLI invocations hanging on stale listeners.
 */
export interface TuiLifecycleRenderer {
    destroy(): void;
    once(event: "destroy", listener: () => void): void;
}

export interface TuiLifecycleProcess {
    off(event: NodeJS.Signals, listener: () => void): void;
    once(event: NodeJS.Signals, listener: () => void): void;
}

export interface TuiLifecycleOptions {
    cleanup?: () => void;
    processLike?: TuiLifecycleProcess;
    signals?: NodeJS.Signals[];
}

export interface TuiLifecycle {
    destroy(): void;
    isDestroyed(): boolean;
    waitForDestroy(): Promise<void>;
}

export function createTuiLifecycle(
    renderer: TuiLifecycleRenderer,
    options: TuiLifecycleOptions = {},
): TuiLifecycle {
    const processLike = options.processLike ?? process;
    const signals = options.signals ?? ["SIGINT", "SIGTERM"];
    let destroyRequested = false;
    let finished = false;
    let resolveDone: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
        resolveDone = resolve;
    });

    const finish = (): void => {
        if (finished) return;
        finished = true;
        for (const signal of signals) {
            processLike.off(signal, signalHandler);
        }
        options.cleanup?.();
        resolveDone?.();
    };

    const signalHandler = (): void => {
        lifecycle.destroy();
    };

    const lifecycle: TuiLifecycle = {
        destroy(): void {
            if (destroyRequested || finished) return;
            destroyRequested = true;
            renderer.destroy();
        },
        isDestroyed(): boolean {
            return finished;
        },
        waitForDestroy(): Promise<void> {
            return done;
        },
    };

    renderer.once("destroy", finish);
    for (const signal of signals) {
        processLike.once(signal, signalHandler);
    }

    return lifecycle;
}
