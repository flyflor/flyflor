import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { ContextComponent } from "../src/components/index.ts";
import { continuityOwnerKey } from "../src/agent/context/component.ts";
import { useContextScope } from "../src/agent/context/composition.ts";
import type { FlyflorPaths } from "../src/config/index.ts";
import { Channel, ChatType } from "../src/protocol/contracts/index.ts";
import type { RuntimeContext } from "../src/protocol/contracts/index.ts";

describe("ContextScopeComponent", () => {
    test("is part of the explicit component inheritance tree", () => {
        const scope = useContextScope(paths("/tmp/flyflor"));

        // Context is a first-class boundary beside neural, not a loose helper
        // bucket for project/fork state.
        expect(scope).toBeInstanceOf(ContextComponent);
    });

    test("maps explicit activeScope to scope-local component paths", () => {
        const scope = useContextScope(paths("/tmp/flyflor"));
        const projectDir = "/tmp/flyflor/workspace/demo";
        const mapped = scope.scopeStorePaths({
            id: "project-demo",
            projectDir,
            projectMemoryDir: join(projectDir, ".flyflor", "memory"),
        });

        expect(mapped.projectDir).toBe(projectDir);
        expect(mapped.projectMemoryDir).toBe(join(projectDir, ".flyflor", "memory"));
        expect(mapped.projectSkillDir).toBe(join(projectDir, ".flyflor", "skills"));
        expect(mapped.projectMcpDir).toBe(join(projectDir, ".flyflor", "mcp"));
        expect(mapped.projectPluginDir).toBe(join(projectDir, ".flyflor", "plugins"));
    });

    test("derives scope constraint only from explicit structure", () => {
        const scope = useContextScope(paths("/tmp/flyflor"));
        const context: RuntimeContext = {
            requestId: "req-1",
            now: "2026-05-17T00:00:00.000Z",
            activeScope: {
                id: "scope-active",
                projectDir: "/tmp/active",
                projectMemoryDir: "/tmp/active/.flyflor/memory",
            },
        };

        expect(scope.scopeConstraintId({ codenameId: "code-1", context })).toBe("scope-active");
    });

    test("returns null when no explicit scope is mounted", () => {
        const scope = useContextScope(paths("/tmp/flyflor"));
        const context: RuntimeContext = {
            requestId: "req-1",
            now: "2026-05-17T00:00:00.000Z",
        };

        expect(scope.scopeConstraintId({ context })).toBeNull();
    });

    test("continuity owner prefers explicit fork over parent scope when both are mounted", () => {
        const context: RuntimeContext = {
            requestId: "req-1",
            now: "2026-05-17T00:00:00.000Z",
            activeScope: {
                id: "scope-active",
                projectDir: "/tmp/active",
                projectMemoryDir: "/tmp/active/.flyflor/memory",
            },
            contextForkId: "fork-active",
        };

        expect(
            continuityOwnerKey(
                {
                    id: "msg-1",
                    receivedAt: "2026-05-17T00:00:00.000Z",
                    text: "hello",
                    attachments: [],
                    user: { id: "user-1", displayName: "User" },
                    route: { channel: Channel.Stdio, chatType: ChatType.Direct, conversationKey: "chat-1" },
                },
                context,
            ),
        ).toBe("fork:fork-active");
    });

    test("continuity owner ignores transport metadata when no explicit scope or fork is mounted", () => {
        expect(
            continuityOwnerKey({
                id: "msg-transport",
                receivedAt: "2026-05-17T00:00:00.000Z",
                text: "hello",
                attachments: [],
                user: { id: "user-transport", displayName: "User" },
                route: {
                    channel: Channel.Stdio,
                    chatType: ChatType.Direct,
                    conversationKey: "chat-transport",
                },
            }),
        ).toBe("turn:msg-transport");
    });
});

function paths(root: string): FlyflorPaths {
    return {
        home: root,
        configDir: root,
        storageDir: join(root, "storage"),
        cacheDir: join(root, "cache"),
        projectDir: join(root, "project"),
        projectFlyflorDir: join(root, "project", ".flyflor"),
        projectSkillDir: join(root, "project", ".flyflor", "skills"),
        projectMcpDir: join(root, "project", ".flyflor", "mcp"),
        projectPluginDir: join(root, "project", ".flyflor", "plugins"),
        projectMemoryDir: join(root, "project", ".flyflor", "memory"),
        workspaceDir: join(root, "workspace"),
        logDir: join(root, "logs"),
        memoryDir: join(root, "memory"),
        pluginDir: join(root, "plugins"),
        promptDir: join(root, "prompts"),
        skillDir: join(root, "skills"),
        templateDir: join(root, "templates"),
        mcpDir: join(root, "mcp"),
    };
}
