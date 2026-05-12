export {
    createSandboxPolicy,
    decideCapabilityExecution,
    gateCapabilityExecution,
    SandboxModule,
    type CapabilityExecutionDecision,
    type CapabilityGateInput,
    type SandboxPolicy,
} from "./sandbox.module.ts";
export {
    ShellHookExecutor,
    type ShellHookSpec,
    type ShellHookResult,
    type ShellHookExecutorOptions,
    type ShellHookSpawnFn,
    type ShellHookSpawnHandle,
} from "./shell.hook.executor.ts";
export { FileAuditSink, AUDITED_EVENTS, type FileAuditSinkOptions } from "./audit.sink.ts";
export {
    addSandboxAllow,
    loadSandboxAllowlist,
    removeSandboxAllow,
    sandboxAllowlistPath,
    type SandboxAllowKind,
    type SandboxAllowlistFile,
    type SandboxAllowlistMerged,
} from "./allowlist.store.ts";
