import type { GatewayMessage } from "../../../protocol/contracts/index.ts";
import { Component } from "../../../agent/di/decorators/index.ts";
import { Runtime } from "../../../components/component.ts";

/**
 * Render inbound attachment metadata into the user message passed to the model.
 * This is intentionally metadata-only: downloading, scanning, and caching binary
 * content stays in the gateway attachment pipeline, not in runtime routing.
 */
@Component()
export class AttachmentSummaryRenderer extends Runtime {
    public renderAttachmentSummary(attachments: GatewayMessage["attachments"]): string {
        if (!attachments || attachments.length === 0) return "";
        const lines = attachments.map((attachment, index) => {
            const parts: string[] = [`#${index + 1}`, attachment.kind];
            if (attachment.name) parts.push(attachment.name);
            else if (attachment.path) parts.push(attachment.path);
            if (attachment.mimeType) parts.push(attachment.mimeType);
            if (typeof attachment.size === "number") parts.push(`${attachment.size}B`);
            if (attachment.sha256) parts.push(`sha256:${attachment.sha256.slice(0, 12)}`);
            return `- ${parts.join(" | ")}`;
        });
        return ["[attachments]", ...lines].join("\n");
    }

    public renderUserContentWithAttachments(message: GatewayMessage): string {
        const continuation = this.renderContinuationAnswerContext(message);
        const summary = this.renderAttachmentSummary(message.attachments);
        const content = continuation ? `${continuation}\n\n${message.text}` : message.text;
        if (!summary) return content;
        return content ? `${content}\n\n${summary}` : summary;
    }

    private renderContinuationAnswerContext(message: GatewayMessage): string {
        const original = message.metadata?.continuationOriginalUserMessage;
        const answer = message.metadata?.askAnswerOriginalText;
        if (typeof original !== "string" || original.trim().length === 0) {
            return "";
        }
        const lines = [
            "[continuation-answer]",
            "Original user request:",
            original.slice(0, 4000),
        ];
        if (typeof answer === "string" && answer.trim().length > 0) {
            lines.push("User answer to the pending ASK:", answer.slice(0, 2000));
        }
        return lines.join("\n");
    }
}

const defaultAttachmentSummaryRenderer = new AttachmentSummaryRenderer();

export function renderAttachmentSummary(attachments: GatewayMessage["attachments"]): string {
    return defaultAttachmentSummaryRenderer.renderAttachmentSummary(attachments);
}

export function renderUserContentWithAttachments(message: GatewayMessage): string {
    return defaultAttachmentSummaryRenderer.renderUserContentWithAttachments(message);
}
