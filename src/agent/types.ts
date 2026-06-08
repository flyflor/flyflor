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

    /** Fixed protocol-package constitution. Loaded from `AGENTS.md`. */
    Agents = 'AGENTS',

    /** Agent extension/capability summary. Loaded from `EXTENSION.md`. */
    Extension = 'EXTENSION',
}
