import { describe, expect, test } from "bun:test";
import {
    BlackboardMode,
    Channel,
    ChatType,
    type GatewayMessage,
} from "../src/protocol/contracts/index.ts";
import { renderAttachmentSummary, renderUserContentWithAttachments } from "../src/agent/runtime/turn/attachments.ts";

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

    test("appends attachment summary to user content without downloading binaries", () => {
        const text = renderUserContentWithAttachments(makeMessage([{ kind: "file", name: "spec.pdf" }]));
        expect(text).toContain("look at this");
        expect(text).toContain("[attachments]");
        expect(text).toContain("spec.pdf");
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
