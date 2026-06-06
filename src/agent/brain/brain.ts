import { FileService, FService, Inject, Prompt, Service } from "@/core";
import { AgentChatRole, Intelligence, type AgentChatMessage } from "./intelligence";
import { Crystall } from "./crystall";
import { Memory } from "../memory";
import type { FAgentProfileConfiguration } from "@/config";

const PROMPT_SECTION_ORDER = ['SOUL', 'USER', 'AGENTS', 'MEMORY'] as const;

type PromptSection = (typeof PROMPT_SECTION_ORDER)[number];

/**
 * Runtime shape loaded from `.config/agents/{agentName}` by `@Prompt`.
 *
 * Each key maps to one canonical prompt markdown file, e.g. `SOUL.md -> data.SOUL`. The type is partial because
 * an agent directory may omit optional sections while the context renderer still keeps a stable section order.
 */
type AgentPrompt = Partial<Record<PromptSection, string>>;

@Service()
export class Brain extends FService {
    @Inject()
    public intelligence!: Intelligence;

    @Inject()
    public crystall!: Crystall;

    @Inject()
    public memory!: Memory;

    /**
     * The agent's prompt is a loaded file object, not raw text.
     *
     * `@Prompt('agent', resolver)` binds this property to `.config/agents/{agentName}` at runtime. The resolver is
     * called from the property getter so it can read `this.agentConfig.name` after the Agent instance exists.
     *
     * `prompt.data` holds the renderable prompt sections. `prompt.blocks` holds parsed `<flyflor:xxx>` protocol
     * blocks for application-level controls. Agent context assembly should consume those in-memory values and must
     * not perform filesystem reads directly.
     */
    @Prompt('agent', function wrapper(this: Brain) {
        return this.config.name;
    })
    public prompt!: FileService<AgentPrompt>;

    /**
     * Conversation turns after the system prompt.
     *
     * The LLM provider sees a fresh ordered message list on every call: one synthesized `system` message first,
     * followed by this user/assistant history. The prompt files themselves are not appended here; they are folded
     * into `systemContext()`.
     */
    public context: AgentChatMessage[] = [];

    constructor(public config: FAgentProfileConfiguration) {
        super();
    }

    public transformer(content: string) {
        this.context.push({ role: AgentChatRole.User, content });
        return this.context;
    }
}
