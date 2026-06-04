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
