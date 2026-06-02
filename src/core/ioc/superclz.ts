/**
 * Root base class for everything the IoC container can resolve.
 *
 * It carries no behavior. Its jobs: make "this class is container-managed" visible in the type system,
 * and anchor the inheritance-based Scope used by `container.listModule(Base)` (red line rule 10).
 *
 * The container resolves every class to a single shared instance — one node per class in the DI tree —
 * so there is no per-class lifecycle flag or enum. Structure (this class hierarchy + the `@Module` graph
 * + `@Inject` edges) is the single source of truth.
 */
export abstract class FService {}

/**
 * Base class for stateful components that own local state or a lifecycle (e.g. the global config component).
 */
export abstract class FComponent extends FService {}

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
