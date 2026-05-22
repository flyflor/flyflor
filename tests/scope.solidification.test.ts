import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { BrainStore } from "../src/cognitive/hippocampus/memory/brain/store.ts";
import { ScopeScaffolder } from "../src/cognitive/hippocampus/scope/scaffolder.ts";
import {
    ScopeSolidificationComponent,
    ScopeSolidificationDecision,
    ScopeTriggerKind,
    type ScopeSolidificationOffer,
} from "../src/cognitive/hippocampus/scope/index.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import { AskReason } from "../src/protocol/contracts/index.ts";
import type { EventSink } from "../src/events/index.ts";

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { force: true, recursive: true })));
});

class NullSink implements EventSink {
    public publish(): void {}
}

describe("ScopeSolidificationComponent", () => {
    test("builds non-freeform ASK confirmation for a candidate offer", () => {
        const component = new ScopeSolidificationComponent();
        const ask = component.buildCreationAsk(offer("scope-ask"));

        expect(ask).toMatchObject({
            reason: AskReason.PolicyDecision,
            freeform: false,
            choices: [
                { value: ScopeSolidificationDecision.Create },
                { value: ScopeSolidificationDecision.Decline },
            ],
        });
        expect(ask.relatedIds).toEqual(["scope-ask", "ep-1", "ep-2"]);
    });

    test("creates a durable Scope only after structured ASK confirmation", async () => {
        const fixture = await makeFixture();
        const component = new ScopeSolidificationComponent();
        const candidate = offer("scope-confirmed");
        try {
            const declined = await component.solidifyConfirmedOffer(fixture.brain, fixture.scaffolder, candidate, {
                decision: ScopeSolidificationDecision.Decline,
                scopeId: candidate.scopeId,
            });
            expect(declined.created).toBe(false);
            expect(fixture.brain.getScope(candidate.scopeId)).toBeNull();

            const created = await component.solidifyConfirmedOffer(fixture.brain, fixture.scaffolder, candidate, {
                decision: ScopeSolidificationDecision.Create,
                scopeId: candidate.scopeId,
                confirmedAt: "2026-05-23T00:00:00.000Z",
                sourceKey: "ask:scope-confirmed",
            });

            expect(created.created).toBe(true);
            expect(created.activeScope).toEqual({
                id: candidate.scopeId,
                title: candidate.title,
                projectDir: join(fixture.paths.workspaceDir, "scopes", candidate.scopeId),
                projectMemoryDir: join(fixture.paths.workspaceDir, "scopes", candidate.scopeId, ".flyflor", "memory"),
            });
            expect(fixture.brain.getScope(candidate.scopeId)).toMatchObject({
                id: candidate.scopeId,
                title: candidate.title,
                goal: candidate.goal,
            });
            expect(await Bun.file(join(fixture.paths.workspaceDir, "scopes", candidate.scopeId, "AGENTS.md")).exists()).toBe(true);
        } finally {
            fixture.brain.close();
        }
    });
});

async function makeFixture(): Promise<{ paths: FlyflorPaths; brain: BrainStore; scaffolder: ScopeScaffolder }> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-scope-solidification-"));
    roots.push(root);
    const paths = makePaths(root);
    await mkdir(join(paths.templateDir, "projects"), { recursive: true });
    for (const file of [
        "AGENTS.md",
        "TODO.md",
        "LOGS.md",
        "README.md",
        "README.zh.cn.md",
        "project.memory.md",
        "project.memory.zh.cn.md",
    ]) {
        await Bun.write(join(paths.templateDir, "projects", file), `# {{title}}\n\nscope={{scopeId}}\ntrigger={{trigger}}\n{{goal}}\n`);
    }
    const brain = new BrainStore({ dbPath: join(paths.configDir, "brain.db") });
    await brain.open();
    return { paths, brain, scaffolder: new ScopeScaffolder(paths, new NullSink()) };
}

function offer(scopeId: string): ScopeSolidificationOffer {
    return {
        ownerKey: "turn:req-1",
        scopeId,
        title: "Vector Scope",
        goal: "Confirmed scope candidate from ASK.",
        triggerKind: ScopeTriggerKind.ClusterCandidate,
        evidenceScore: 0.82,
        relatedIds: ["ep-1", "ep-2"],
        proposedAt: "2026-05-23T00:00:00.000Z",
    };
}

function makePaths(root: string): FlyflorPaths {
    return {
        home: root,
        configDir: root,
        storageDir: join(root, "storage"),
        cacheDir: join(root, "cache"),
        workspaceDir: join(root, "workspace"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        projectMemoryDir: join(root, "memory", "projects"),
        pluginDir: join(root, "plugins"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        templateDir: join(root, "templates"),
        mcpDir: join(root, "mcp"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
    };
}

