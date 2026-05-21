/**
 * Scope 脚手架（ScopeScaffolder）。
 *
 * 当 detectExplicitIntent / detectClusterCandidate 返回非 None 的 trigger 时，
 * 在 workspace/scopes/{scopeId}/{AGENTS,TODO,README}.md 落盘 scope 骨架，并预建 `.flyflor/memory`。
 *
 * 设计约束（与 docs/boundaries.md 对齐）：
 *  - 模板源文件来自 paths.templateDir/projects，磁盘模板目录暂保留兼容命名；
 *  - 路径用 paths.workspaceDir/scopes/{scopeId}，每个 scopeId 单独目录；
 *  - 文件已存在时不覆盖（幂等），便于多轮触发；
 *  - 失败发事件后继续抛出，调用方必须处理。
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../../config/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";
import { ScopeTriggerKind, type ScopeTriggerResult } from "./index.ts";

const SCOPE_FILES = ["AGENTS.md", "TODO.md", "README.md"] as const;
type ScopeFile = (typeof SCOPE_FILES)[number];

const SCOPE_TEMPLATE_FILES: Record<ScopeFile, string> = {
    "AGENTS.md": "AGENTS.md",
    "README.md": "README.md",
    "TODO.md": "TODO.md",
};

export interface ScopeScaffoldInput {
    scopeId: string;
    /** Optional explicit scope directory from `/project <path>` compatibility command. */
    projectDir?: string;
    title: string;
    goal: string;
    sourceKey?: string;
    trigger: ScopeTriggerResult;
    createdAt: string;
}

export interface ScopeScaffoldResult {
    scopeId: string;
    projectDir: string;
    written: ScopeFile[];
    skipped: ScopeFile[];
}

export class ScopeScaffolder {
    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly events: EventSink,
    ) {}

    /**
     * Idempotent scaffold. 已存在的文件保持不动；只新建缺失的。
     * trigger.kind === None 时直接返回空结果。
     */
    public async scaffold(input: ScopeScaffoldInput): Promise<ScopeScaffoldResult> {
        const projectDir = input.projectDir ?? join(this.paths.workspaceDir, "scopes", input.scopeId);
        const result: ScopeScaffoldResult = {
            scopeId: input.scopeId,
            projectDir,
            written: [],
            skipped: [],
        };
        if (input.trigger.kind === ScopeTriggerKind.None) {
            return result;
        }
        try {
            await mkdir(projectDir, { recursive: true });
            await Promise.all(
                ["skills", "mcp", "plugins", "memory"].map((name) =>
                    mkdir(join(projectDir, ".flyflor", name), { recursive: true }),
                ),
            );
            for (const file of SCOPE_FILES) {
                const targetPath = join(projectDir, file);
                if (await Bun.file(targetPath).exists()) {
                    result.skipped.push(file);
                    continue;
                }
                const template = await readProjectTemplate(this.paths.templateDir, file);
                const content = renderTemplate(template, {
                    title: input.title,
                    goal: input.goal,
                    projectId: input.scopeId,
                    scopeId: input.scopeId,
                    sourceKey: input.sourceKey ?? "",
                    trigger: input.trigger.kind,
                    createdAt: input.createdAt,
                    relatedIds: input.trigger.relatedIds.length
                        ? input.trigger.relatedIds.slice(0, 8).join(", ")
                        : "(none)",
                });
                await Bun.write(targetPath, content);
                result.written.push(file);
            }
            const scopeManifestPath = join(projectDir, ".flyflor", "scope.json");
            if (!(await Bun.file(scopeManifestPath).exists())) {
                await Bun.write(
                    scopeManifestPath,
                    `${JSON.stringify(
                        {
                            schemaVersion: 1,
                            scopeId: input.scopeId,
                            title: input.title,
                            goal: input.goal,
                            sourceKey: input.sourceKey,
                            createdAt: input.createdAt,
                            trigger: {
                                kind: input.trigger.kind,
                                score: input.trigger.score,
                                rationale: input.trigger.rationale,
                                relatedIds: input.trigger.relatedIds,
                            },
                        },
                        null,
                        2,
                    )}\n`,
                );
            }
            this.events.publish(
                event(RuntimeEventType.ScopeScaffolded, {
                    scopeId: input.scopeId,
                    projectDir,
                    written: result.written,
                    skipped: result.skipped,
                    trigger: input.trigger.kind,
                }),
            );
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.ScopeScaffoldFailed, {
                    scopeId: input.scopeId,
                    error: String(err),
                }),
            );
            // Scope-local memory is only valid after AGENTS.md and the scope
            // redlines exist. Failing loudly prevents later memory writes from
            // creating a scope directory without its governing constitution.
            throw err;
        }
        return result;
    }
}

async function readProjectTemplate(templateRoot: string, file: ScopeFile): Promise<string> {
    const path = join(templateRoot, "projects", SCOPE_TEMPLATE_FILES[file]);
    const handle = Bun.file(path);
    if (!(await handle.exists())) {
        throw new Error(`Missing project template: ${path}. Run "bun run install:templates".`);
    }
    return (await handle.text()).trimEnd();
}

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/gu, (match, key: string) => values[key] ?? match);
}
