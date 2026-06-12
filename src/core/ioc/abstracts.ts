import { type FLogger, useLogger } from '../logger';
import { Observable, Subject } from 'rxjs';

const LOGGER_CACHE_KEY = Symbol('flyflor.logger');

interface FlyFlorLoggerHost {
    [LOGGER_CACHE_KEY]?: FLogger;
    constructor: { name?: string };
}

function loggerFor(host: FlyFlorLoggerHost): FLogger {
    const scope = host.constructor.name;
    host[LOGGER_CACHE_KEY] ??= scope === undefined || scope.length === 0 ? useLogger() : useLogger(scope);
    return host[LOGGER_CACHE_KEY];
}

export abstract class FlyFlor {
    public get log(): FLogger {
        return loggerFor(this);
    }
}

export abstract class FSubject<T = object | number | string | boolean | undefined> extends Subject<T> {
    public get log(): FLogger {
        return loggerFor(this);
    }
}

export abstract class FService extends FlyFlor {}

/**
 * Base class for stateful components that own local state or a lifecycle (e.g. the global config component).
 */
export abstract class FComponent extends FService {}

/**
 * Base class for path-bound file objects. A file object owns a concrete filesystem path and its loaded state.
 */
export abstract class FFile extends FComponent {}

/**
 * Base class for module boundaries declared with `@Module()` (capillary, ipc, guard, agent, root).
 */
export abstract class FModule extends FComponent {}

/**
 * Base class for data repositories under `src/entities` (classes decorated with `@Repo()`).
 */
export abstract class FRepo extends FService {}

export type PluginSignal<TData = unknown> =
    | { type: 'start'; plugin: string; data?: TData }
    | { type: 'delta'; plugin: string; data: TData }
    | { type: 'end'; plugin: string; data?: TData }
    | { type: 'error'; plugin: string; error: Error };

/**
 * Base class for external plugin boundaries (classes decorated with `@Plugin()`).
 * Plugins are active observation objects: they can expose methods and emit turn-local signals.
 */
export abstract class FPlugin<TSignal = PluginSignal> extends FSubject<TSignal> {}

/**
 * Identity, schema, and policy facts one tool declares about itself.
 * Subclasses pass this to `super()` so every field is initialized in one constructor act.
 */
export interface ToolDescriptor {
    /** Stable tool name — the addressing anchor for prompts, parsing, and future policy rules. */
    name: string;

    /** Model-visible behavior summary rendered into the execution system prompt. */
    description: string;

    /** Model-visible JSON-schema-shaped input contract. */
    parameters: Record<string, unknown>;

    /** Read-only tools are admitted into the callosal investigation phase; mutating tools are not. */
    readOnly?: boolean;

    /** Terminal tools (ask/confirm) end the execution loop and hand the turn back to the user. */
    terminal?: boolean;

    /** Per-tool result budget applied by the registry when a result is recorded, not when read back. */
    maxResultChars?: number;
}

/**
 * Turn-scoped state shared by every tool execution within one turn.
 *
 * `reads` is the mechanical read-before-write ledger: the read tool records a content snapshot per
 * path, and mutating file tools refuse to touch an existing file that was never read this turn or
 * that changed on disk since its snapshot.
 */
export interface ToolContext {
    cwd: string;
    reads: Map<string, string>;
}

/**
 * Base class for executable tools — the agent's hands on the computer.
 *
 * A tool is a specialized plugin (`FTool extends FPlugin`, like `FSandBox extends FGuard`): it keeps
 * plugin signal semantics for future streamed progress, and adds the model-visible descriptor plus one
 * `execute` action. Tools are discovered structurally via `listModule(FTool)` — importing the class in
 * `ToolsModule` is registration; no manual registry list exists.
 */
export abstract class FTool<TInput = Record<string, unknown>> extends FPlugin {
    public readonly name: string;
    public readonly description: string;
    public readonly parameters: Record<string, unknown>;
    public readonly readOnly: boolean;
    public readonly terminal: boolean;
    public readonly maxResultChars: number;

    constructor(descriptor: ToolDescriptor) {
        super();
        this.name = descriptor.name;
        this.description = descriptor.description;
        this.parameters = descriptor.parameters;
        this.readOnly = descriptor.readOnly ?? false;
        this.terminal = descriptor.terminal ?? false;
        this.maxResultChars = descriptor.maxResultChars ?? 30_000;
    }

    /**
     * Runs one tool call. Implementations return the raw textual result; truncation, error
     * wrapping, and protocol feedback are owned by the registry choke point, not the tool.
     */
    public abstract execute(input: TInput, context: ToolContext): Promise<string>;
}

/**
 * Base class for permission/policy subscribers (classes decorated with `@Guard()`).
 * Discovered as a group via `container.listModule(FGuard)` so each guard can subscribe to the capillary layer —
 * discovery is structural (by base class), never by a metadata flag.
 */
export abstract class FGuard extends FService {}

/**
 * Base class for sandbox policy subscribers (classes decorated with `@SandBox()`), a specialization of `FGuard`.
 * Appears in both `listModule(FGuard)` and `listModule(FSandBox)`.
 */
export abstract class FSandBox extends FGuard {}

/**
 * Base class for autonomous intelligent agents ("person" semantic).
 *
 * Parallel to `FService`: an agent is NOT a stateless service — it has its own mind (soul), its own
 * memory, its own capillary subscriptions. The runtime uses `FAgent` to discover every active agent
 * via `listModule(FAgent)` and to manage their lifecycles. An agent's `chat` is the canonical
 * entry point: the runtime never inspects or rewrites the agent's system prompt.
 */
export abstract class FAgentAtom<T = object | number | string | boolean | undefined> extends FSubject<T> {}
export abstract class FAgent<T = object | number | string | boolean | undefined> extends FAgentAtom<T> {}

/**
 * Base class for agent-side routing subjects.
 *
 * A route is an active observer/inspector in the neural layer: it emits routing signals while it decides
 * whether a turn is a direct reflex, a protocol-package update, or an execution turn that needs tools.
 */
export abstract class FRoute<TSignal = unknown> extends FSubject<TSignal> {}

/**
 * One structured signal emitted by a cortex stream (e.g. `Brain`).
 * `delta` carries an incremental text fragment; `done` marks the end of a reflex. Isomorphic to
 * `PluginSignal` so reflection/tool signals can extend this union later without changing the seam.
 */
export type AgentSignal =
    | { type: 'delta'; text: string }
    | { type: 'done' };

/**
 * Base class for cortical signal transforms ("synapse" semantic).
 *
 * A cortex receives an assembled input, turns it into an output `Observable`, and is itself a
 * `Subject` others can subscribe to or pipe through — the reusable primitive for the neural network.
 * Subclasses own only the wire of one reflex: `transform(input)` returns the cold output stream.
 */
export abstract class FCortex<I, O> extends FSubject<O> {
    public abstract transform(input: I): Observable<O>;
}
