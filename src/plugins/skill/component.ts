import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Plugin, FPlugin, Inject, Init } from '@/core';
import { ConfigComponent } from '@/shard/components/config';

/**
 * A discovered skill: a directory-based capability described by its `SKILL.md` frontmatter.
 * - `name`: the skill's invocation name.
 * - `description`: one-line summary used to decide relevance.
 * - `directory`: absolute path to the skill folder.
 */
export interface SkillManifest {
    name: string;
    description: string;
    directory: string;
}

/**
 * The skill plugin: discovers and loads directory-based skills (Claude-Code style).
 *
 * Each skill lives in its own folder under the configured skills directory and carries a `SKILL.md` whose
 * frontmatter declares `name` and `description`. The agent lists skills to decide relevance, then loads a
 * skill's full markdown to inject as guidance. Honest: a missing directory yields zero skills, never a fake.
 */
@Plugin()
export class SkillComponent extends FPlugin {
    /** Default skills directory when config omits one. */
    private static readonly DEFAULT_DIR = './.config/skills';
    /** The canonical skill descriptor file inside each skill folder. */
    private static readonly MANIFEST_FILE = 'SKILL.md';

    @Inject() private readonly config!: ConfigComponent;

    /** Discovered skill manifests, populated by `init()`. */
    private manifests: SkillManifest[] = [];

    /**
     * Scans the skills directory at startup.
     */
    @Init()
    public async init(): Promise<void> {
        await this.scan();
    }

    /**
     * (Re)scans the skills directory, parsing each sub-folder's `SKILL.md` frontmatter.
     */
    public async scan(): Promise<void> {
        const dir = this.config.resolveFromRoot(this.config.skills?.directory ?? SkillComponent.DEFAULT_DIR);
        this.manifests = [];
        try {
            const entries = await readdir(dir, { withFileTypes: true });
            for (const entry of entries) {
                if (!entry.isDirectory()) {
                    continue;
                }
                const manifest = await this.readManifest(join(dir, entry.name), entry.name);
                if (manifest !== undefined) {
                    this.manifests.push(manifest);
                }
            }
            console.log(`[Skill] Loaded ${this.manifests.length} skill(s) from ${dir}`);
        } catch {
            console.log(`[Skill] No skills directory at ${dir} (0 skills)`);
        }
    }

    /**
     * Lists the discovered skill manifests.
     * @returns a copy of the manifests.
     */
    public list(): SkillManifest[] {
        return [...this.manifests];
    }

    /**
     * Loads a skill's full `SKILL.md` content for injection into the agent's context.
     * @param name - the skill name.
     * @returns the markdown content.
     */
    public async load(name: string): Promise<string> {
        const manifest = this.manifests.find((skill) => skill.name === name);
        if (manifest === undefined) {
            throw Object.assign(new Error('Skill not found'), { detail: { name } });
        }
        return readFile(join(manifest.directory, SkillComponent.MANIFEST_FILE), 'utf8');
    }

    /**
     * Reads and parses one skill folder's `SKILL.md` frontmatter.
     * @param directory - the skill folder.
     * @param fallbackName - folder name used if frontmatter omits `name`.
     * @returns the manifest, or `undefined` if the folder has no `SKILL.md`.
     */
    private async readManifest(directory: string, fallbackName: string): Promise<SkillManifest | undefined> {
        try {
            const markdown = await readFile(join(directory, SkillComponent.MANIFEST_FILE), 'utf8');
            const name = markdown.match(/^name:\s*(.+)$/m)?.[1]?.trim() ?? fallbackName;
            const description = markdown.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? '';
            return { name, description, directory };
        } catch {
            return undefined;
        }
    }
}
