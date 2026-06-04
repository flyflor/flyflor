/**
 * One of the four canonical soul sections owned by an agent.
 *
 * Section names match the markdown filenames loaded from `.config/agents/<name>/` (English canonical only,
 * per AGENTS.md red line 5). Adding a new section means adding one new `.md` file plus a new enum member.
 */
export enum SoulSection {
    /** Agent identity / constitution layer. Loaded from `SOUL.md`. */
    Soul = 'SOUL',

    /** User profile (画像). Loaded from `USER.md`. */
    User = 'USER',

    /** Agent operating instructions: startup, task loop, tool usage. Loaded from `AGENTS.md`. */
    Agents = 'AGENTS',

    /** Short-term rolling memory. Loaded from `MEMORY.md`. */
    Memory = 'MEMORY',
}

/**
 * The order in which soul documents are joined into the system prompt.
 * Identity first, then user, then operating instructions, then rolling memory last.
 */
export const SOUL_SECTION_ORDER: readonly SoulSection[] = [
    SoulSection.Soul,
    SoulSection.User,
    SoulSection.Agents,
    SoulSection.Memory,
] as const;

/**
 * Sections that MUST be present at boot. Missing any of them is a fatal constitution-layer violation:
 * Flyflor prefers to refuse to start over running with an incomplete soul.
 */
export const SOUL_REQUIRED_SECTIONS: readonly SoulSection[] = [
    SoulSection.Soul,
    SoulSection.User,
    SoulSection.Agents,
    SoulSection.Memory,
] as const;

/**
 * One in-memory soul document: the canonical section name, the raw markdown content, and the last
 * update timestamp (ISO 8601). The content is mutable in memory; persistence is intentionally
 * deferred to a later phase and out of scope for the constitution-layer pass.
 */
export interface SoulDocument {
    section: SoulSection;
    content: string;
    updatedAt: string;
}

/**
 * A draft crystallization request. The mind layer produces these; the agent consults the capillary
 * layer (via subscribed guards) before applying them.
 */
export interface SoulCrystallizeDraft {
    section: SoulSection;
    content: string;
    reason: string;
}

/**
 * Capillary topic emitted once the agent has finished its initial soul load.
 * Payload: `{ name: string, sections: SoulSection[] }`.
 */
export const AGENT_TOPIC_SOUL_LOADED = 'agent.soul.loaded';

/**
 * Capillary topic emitted at the end of every chat turn.
 * Payload: `{ role, content, section? }`.
 */
export const AGENT_TOPIC_SOUL_TURN = 'agent.soul.turn';

/**
 * Capillary consult topic for proposed memory writes. Guards may allow or deny.
 * Payload: `SoulCrystallizeDraft`.
 */
export const AGENT_TOPIC_SOUL_CRYSTALLIZE = 'agent.soul.crystallize';

/**
 * Capillary notice emitted when a soul section is missing at boot or mid-flight.
 * Payload: `{ section: SoulSection }`.
 */
export const AGENT_TOPIC_SOUL_MISS = 'agent.soul.miss';
