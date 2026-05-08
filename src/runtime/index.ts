import type { FlyflorConfig } from "../config/index.ts";
import type { GatewayMessage, GatewayReply, ModelClient, ModelMessage, RuntimeContext } from "../shared/core/types.ts";
import { event, type EventSink } from "../shared/events/index.ts";
import { createMemory, type AgentMemory } from "../modules/memory/index.ts";
import { loadMcpServers, renderMcpPrompt } from "../modules/mcp/index.ts";
import { createSandboxPolicy } from "../modules/sandbox/index.ts";
import { loadSkills, renderSkillPrompt, selectSkills } from "../modules/skills/index.ts";

export class AgentRuntime {
    private readonly memory: AgentMemory;

    constructor(
        private readonly config: FlyflorConfig,
        private readonly model: ModelClient,
        private readonly events: EventSink,
    ) {
        this.memory = createMemory(config, events);
    }

    async handleMessage(message: GatewayMessage, context: RuntimeContext): Promise<GatewayReply> {
        this.events.publish(event("agent.turn.start", { channel: message.route.channel }, context.requestId));

        const [skills, mcpServers, memoryPrompt] = await Promise.all([
            loadSkills(this.config.paths),
            loadMcpServers(this.config.paths),
            this.memory.buildPrompt(message),
        ]);
        const selectedSkills = selectSkills(skills, message.text);
        const sandbox = createSandboxPolicy(this.config.sandbox);

        const modelMessages: ModelMessage[] = [
            {
                role: "system",
                content: [
                    "You are Flyflor, an agent runtime connected through a multi-channel gateway.",
                    "Answer the user directly. Do not claim to have executed tools unless a tool result is present.",
                    `Sandbox policy: ${sandbox.summary}`,
                    "Memory context:",
                    memoryPrompt,
                    "Loaded skills:",
                    renderSkillPrompt(selectedSkills),
                    "Configured MCP servers:",
                    renderMcpPrompt(mcpServers),
                ].join("\n\n"),
            },
            {
                role: "user",
                content: message.text,
            },
        ];

        const text = await this.model.generate(modelMessages);
        const reply: GatewayReply = {
            messageId: crypto.randomUUID(),
            route: message.route,
            text,
            metadata: {
                mcpServers: mcpServers.filter((server) => server.enabled).map((server) => server.name),
                sandboxMode: sandbox.mode,
                skills: selectedSkills.map((skill) => skill.name),
            },
        };
        await this.memory.rememberTurn(message, reply, context);
        this.events.publish(event("agent.turn.end", { channel: message.route.channel }, context.requestId));

        return reply;
    }
}
