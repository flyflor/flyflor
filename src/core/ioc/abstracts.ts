import { Observable, Subject } from 'rxjs';

export abstract class FlyFlor {}

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

/**
 * Base class for external plugin boundaries (classes decorated with `@Plugin()`).
 */
export abstract class FPlugin extends FService {}

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
export abstract class FAgent<T = object | number | string | boolean | undefined> extends Subject<T> {}
