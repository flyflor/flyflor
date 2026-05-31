import { randomUUID } from "node:crypto";
import { ConfigService } from "../config/config.service";
import type { SpawnAgentToolInput, Tool, ToolContext, ToolResult } from "./tool.types";
import type { WorkerSettledPayload, WorkerSpawnPayload } from "../worker";

/**
 * Spawns an in-process worker agent through the SignalBus.
 *
 * @usage Unlike `task`, this is a lightweight sub-agent delegation path. It does
 * not start hidden child processes; WorkerService owns execution after the
 * `worker.spawn` signal, and foreground calls wait for `worker.settled`.
 */
export class SpawnAgentTool implements Tool<SpawnAgentToolInput> {
  public readonly name = "spawn_agent";
  public readonly description = "Spawn an in-process worker agent and optionally wait for its result.";
  public readonly execution = { mutability: "mutating" as const, concurrency: "serial" as const, riskLevel: "medium" as const };
  public readonly schema = {
    type: "object" as const,
    required: ["prompt"],
    additionalProperties: false,
    properties: {
      agentProfile: { type: "string" as const, description: "Configured worker profile name such as explore, investigate, code, or general." },
      prompt: { type: "string" as const, description: "Task prompt for the worker." },
      background: { type: "boolean" as const, description: "Return immediately after spawning instead of waiting for worker.settled.", default: false },
    },
  };

  public constructor(private readonly configService = new ConfigService()) {}

  public async execute(input: SpawnAgentToolInput, context: ToolContext): Promise<ToolResult> {
    const agentProfile = input.agentProfile?.trim() || "general";
    const profile = this.configService.getConfig().agents.profiles[agentProfile];
    if (!profile) {
      return { ok: false, output: `worker profile unavailable: ${agentProfile}` };
    }
    if (!context.conversationId) {
      return { ok: false, output: "spawn_agent requires conversationId in ToolContext" };
    }
    const workerId = randomUUID();
    const approved = await context.signalBus.ask("guard.spawn", {
      toolName: this.name,
      workerId,
      agentProfile,
      prompt: input.prompt,
      parentTurnId: context.turnId,
      parentConversationId: context.conversationId,
    });
    if (!approved) {
      return { ok: false, output: `worker spawn denied: ${agentProfile}` };
    }
    const payload: WorkerSpawnPayload = {
      workerId,
      agentProfile,
      prompt: input.prompt,
      parentTurnId: context.turnId,
      parentConversationId: context.conversationId,
      background: input.background ?? false,
    };
    if (input.background) {
      await context.signalBus.emit("worker.spawn", payload);
      return {
        ok: true,
        output: `<worker id="${workerId}" profile="${agentProfile}" state="running" />`,
        metadata: { workerId, agentProfile, background: true },
      };
    }
    const settled = this.waitForSettled(context, workerId);
    await context.signalBus.emit("worker.spawn", payload);
    const result = await settled;
    if (result.status === "completed") {
      return {
        ok: true,
        output: `<worker id="${workerId}" profile="${agentProfile}" state="completed">\n${result.summary ?? ""}\n</worker>`,
        metadata: { workerId, agentProfile, background: false },
      };
    }
    return {
      ok: false,
      output: `<worker id="${workerId}" profile="${agentProfile}" state="failed">\n${result.error ?? "worker failed"}\n</worker>`,
      metadata: { workerId, agentProfile, background: false },
    };
  }

  private waitForSettled(context: ToolContext, workerId: string): Promise<WorkerSettledPayload> {
    return new Promise((resolve) => {
      const subscription = context.signalBus.subscribe<WorkerSettledPayload>("worker.settled", (payload) => {
        if (payload.workerId !== workerId) {
          return;
        }
        subscription.unsubscribe();
        resolve(payload);
      });
    });
  }
}
