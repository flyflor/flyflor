import { join } from "node:path";
import { PluginRunner, type PluginInvocationResult } from "../../plugin/index.ts";
import type { FlyflorPaths } from "../../../config/index.ts";
import type { EventSink } from "../../../events/index.ts";
import type { SandboxPolicy } from "../../sandbox/index.ts";
import type { CttlManifestToolDefinition } from "../../../executive/index.ts";

export const USER_TOOL_SERVER = "user";

export interface UserToolInvocationInput {
    approve?: (tool: CttlManifestToolDefinition) => boolean | Promise<boolean>;
    events: EventSink;
    input: Record<string, unknown>;
    paths: FlyflorPaths;
    policy: SandboxPolicy;
    tool: CttlManifestToolDefinition;
}

export async function invokeUserTool(input: UserToolInvocationInput): Promise<PluginInvocationResult> {
    const executor = input.tool.executor;
    if (!executor) {
        return {
            ok: false,
            exitCode: null,
            timedOut: false,
            stderr: "",
            truncated: false,
            durationMs: 0,
            error: `user tool has no process-json executor: ${input.tool.descriptor.name}`,
        };
    }
    const runner = new PluginRunner({
        policy: input.policy,
        events: input.events,
        allowedCommands: [executor.command],
        approve: input.approve ? () => input.approve!(input.tool) : undefined,
        maxOutputBytes: executor.maxOutputBytes,
        maxTimeoutMs: executor.timeoutMs,
    });
    return runner.invoke({
        plugin: {
            capabilities: [],
            name: input.tool.descriptor.name,
            entry: executor.command,
            enabled: input.tool.enabled,
            source: input.tool.manifestSource,
            description: input.tool.descriptor.description,
        },
        command: executor.command,
        args: executor.args,
        cwd: executor.cwd === "config" ? input.paths.configDir : input.paths.projectDir,
        env: executor.env,
        timeoutMs: executor.timeoutMs,
        request: {
            tool: input.tool.descriptor.name,
            input: input.input,
            cwd: executor.cwd,
            projectDir: input.paths.projectDir,
            configDir: input.paths.configDir,
        },
    });
}

export function userToolWorkingDirectory(paths: FlyflorPaths, cwd: "project" | "config"): string {
    return cwd === "config" ? paths.configDir : paths.projectDir;
}

export function resolveUserToolArg(paths: FlyflorPaths, value: string): string {
    if (value === "{projectDir}") return paths.projectDir;
    if (value === "{configDir}") return paths.configDir;
    if (value.startsWith("{projectDir}/")) return join(paths.projectDir, value.slice("{projectDir}/".length));
    if (value.startsWith("{configDir}/")) return join(paths.configDir, value.slice("{configDir}/".length));
    return value;
}
