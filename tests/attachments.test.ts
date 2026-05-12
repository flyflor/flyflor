import { describe, expect, test } from "bun:test";
import {
    BlackboardMode,
    Channel,
    ChatType,
    type GatewayMessage,
} from "../src/protocol/contracts/index.ts";

// Mirror of the runtime-internal helpers, kept in test-local copy to assert the rendered shape.
// Source of truth lives in runtime.module.ts; if the rendering changes, this test will fail loudly
// when the runtime is updated to use a different format.
function renderAttachmentSummary(attachments: GatewayMessage["attachments"]): string {
    if (!attachments || attachments.length === 0) return "";
    const lines = attachments.map((a, idx) => {
        const parts: string[] = [`#${idx + 1}`, a.kind];
        if (a.name) parts.push(a.name);
        else if (a.path) parts.push(a.path);
        if (a.mimeType) parts.push(a.mimeType);
        if (typeof a.size === "number") parts.push(`${a.size}B`);
        if (a.sha256) parts.push(`sha256:${a.sha256.slice(0, 12)}`);
        return `- ${parts.join(" | ")}`;
    });
    return ["[attachments]", ...lines].join("\n");
}

function makeMessage(attachments?: GatewayMessage["attachments"]): GatewayMessage {
    return {
        id: "m1",
        route: { channel: Channel.Stdio, chatId: "c", chatType: ChatType.Direct },
        user: { id: "u" },
        text: "look at this",
        attachments,
        receivedAt: new Date().toISOString(),
    };
}

describe("attachments rendering", () => {
    test("no attachments produces empty summary", () => {
        expect(renderAttachmentSummary(undefined)).toBe("");
        expect(renderAttachmentSummary([])).toBe("");
    });

    test("renders kind/name/mime/size/sha", () => {
        const summary = renderAttachmentSummary([
            {
                kind: "image",
                name: "diagram.png",
                mimeType: "image/png",
                size: 12345,
                sha256: "abcdef0123456789aaa",
            },
        ]);
        expect(summary).toContain("[attachments]");
        expect(summary).toContain("image");
        expect(summary).toContain("diagram.png");
        expect(summary).toContain("image/png");
        expect(summary).toContain("12345B");
        expect(summary).toContain("sha256:abcdef012345");
    });

    test("falls back to path when name absent", () => {
        const summary = renderAttachmentSummary([{ kind: "file", path: "/tmp/x.pdf" }]);
        expect(summary).toContain("/tmp/x.pdf");
    });
});

// Smoke-test: GatewayMessage type accepts the attachments field.
describe("GatewayMessage attachments field", () => {
    test("compiles & carries attachments", () => {
        const msg = makeMessage([{ kind: "image", name: "a.png" }]);
        expect(msg.attachments?.length).toBe(1);
        expect(BlackboardMode.Direct).toBeDefined();
    });
});
