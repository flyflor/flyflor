/**
 * 项目脚手架（ProjectScaffolder）。
 *
 * 当 detectExplicitIntent / detectClusterCandidate 返回非 None 的 trigger 时，
 * 在 workspace/projects/{projectId}/{AGENTS,TODO,README}.md 落盘项目骨架，并预建项目 `.flyflor/memory`。
 *
 * 设计约束（与 docs/boundaries.md 对齐）：
 *  - 模板源文件使用小写点分名，由 install.templates.ts 拷贝到 paths.templateDir/projects；
 *  - 路径用 paths.workspaceDir/projects/{projectId}，每个 projectId 单独目录；
 *  - 文件已存在时不覆盖（幂等），便于多轮触发；
 *  - 失败发事件后继续抛出，调用方必须处理。
 */

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { FlyflorPaths } from "../../../config/index.ts";
import { event, RuntimeEventType, type EventSink } from "../../../events/index.ts";
import { ProjectTriggerKind, type ProjectTriggerResult } from "./index.ts";

const PROJECT_FILES = ["AGENTS.md", "TODO.md", "README.md"] as const;
type ProjectFile = (typeof PROJECT_FILES)[number];

const PROJECT_TEMPLATE_FILES: Record<ProjectFile, string> = {
    "AGENTS.md": "AGENTS.md",
    "README.md": "README.md",
    "TODO.md": "TODO.md",
};

export interface ProjectScaffoldInput {
    projectId: string;
    /** Optional explicit project directory from `/project <path>`; default remains workspace/projects/<projectId>. */
    projectDir?: string;
    title: string;
    goal: string;
    userId: string;
    trigger: ProjectTriggerResult;
    createdAt: string;
}

export interface ProjectScaffoldResult {
    projectId: string;
    projectDir: string;
    written: ProjectFile[];
    skipped: ProjectFile[];
}

export class ProjectScaffolder {
    public constructor(
        private readonly paths: FlyflorPaths,
        private readonly events: EventSink,
    ) {}

    /**
     * Idempotent scaffold. 已存在的文件保持不动；只新建缺失的。
     * trigger.kind === None 时直接返回空结果。
     */
    public async scaffold(input: ProjectScaffoldInput): Promise<ProjectScaffoldResult> {
        const projectDir = input.projectDir ?? join(this.paths.workspaceDir, "projects", input.projectId);
        const result: ProjectScaffoldResult = {
            projectId: input.projectId,
            projectDir,
            written: [],
            skipped: [],
        };
        if (input.trigger.kind === ProjectTriggerKind.None) {
            return result;
        }
        try {
            await mkdir(projectDir, { recursive: true });
            await Promise.all(
                ["skills", "mcp", "plugins", "memory"].map((name) =>
                    mkdir(join(projectDir, ".flyflor", name), { recursive: true }),
                ),
            );
            for (const file of PROJECT_FILES) {
                const targetPath = join(projectDir, file);
                if (await Bun.file(targetPath).exists()) {
                    result.skipped.push(file);
                    continue;
                }
                const template = await readProjectTemplate(this.paths.templateDir, file);
                const content = renderTemplate(template, {
                    title: input.title,
                    goal: input.goal,
                    projectId: input.projectId,
                    userId: input.userId,
                    trigger: input.trigger.kind,
                    createdAt: input.createdAt,
                    relatedIds: input.trigger.relatedIds.length
                        ? input.trigger.relatedIds.slice(0, 8).join(", ")
                        : "(none)",
                });
                await Bun.write(targetPath, content);
                result.written.push(file);
            }
            const projectManifestPath = join(projectDir, ".flyflor", "project.json");
            if (!(await Bun.file(projectManifestPath).exists())) {
                await Bun.write(
                    projectManifestPath,
                    `${JSON.stringify(
                        {
                            schemaVersion: 1,
                            projectId: input.projectId,
                            title: input.title,
                            goal: input.goal,
                            userId: input.userId,
                            createdAt: input.createdAt,
                        },
                        null,
                        2,
                    )}\n`,
                );
            }
            this.events.publish(
                event(RuntimeEventType.ProjectScaffolded, {
                    projectId: input.projectId,
                    projectDir,
                    written: result.written,
                    skipped: result.skipped,
                    trigger: input.trigger.kind,
                }),
            );
        } catch (err) {
            this.events.publish(
                event(RuntimeEventType.ProjectScaffoldFailed, {
                    projectId: input.projectId,
                    error: String(err),
                }),
            );
            // Project-local memory is only valid after AGENTS.md and the project
            // redlines exist. Failing loudly prevents later memory writes from
            // creating a project directory without its governing constitution.
            throw err;
        }
        return result;
    }
}

async function readProjectTemplate(templateRoot: string, file: ProjectFile): Promise<string> {
    const path = join(templateRoot, "projects", PROJECT_TEMPLATE_FILES[file]);
    const handle = Bun.file(path);
    if (!(await handle.exists())) {
        throw new Error(`Missing project template: ${path}. Run "bun run install:templates".`);
    }
    return (await handle.text()).trimEnd();
}

function renderTemplate(template: string, values: Record<string, string>): string {
    return template.replace(/\{\{\s*([A-Za-z0-9_-]+)\s*\}\}/gu, (match, key: string) => values[key] ?? match);
}
