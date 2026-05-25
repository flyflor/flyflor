import type { AgentAsk } from "../../../protocol/contracts/index.ts";
import type { GatewayControlLongHorizonLoopSnapshot } from "../../../protocol/control/index.ts";
import {
    AskPresentationComponent,
    askPresentationComponent,
} from "../../../cognitive/hippocampus/ask/index.ts";

/**
 * Runtime compatibility adapter for ASK presentation.
 *
 * ASK rendering now belongs to `src/cognitive/hippocampus/ask`; this file keeps
 * older runtime imports stable while new callers depend on AskComponent.
 */
export class AskReplyRenderer extends AskPresentationComponent {
    public renderAskReplyText(ask: AgentAsk): string {
        return this.renderReplyText(ask);
    }

    public buildAskMetadata(
        ask: AgentAsk,
        snapshotId: string,
        executiveToolLoop?: GatewayControlLongHorizonLoopSnapshot,
    ): Record<string, unknown> {
        return this.buildMetadata(ask, snapshotId, executiveToolLoop);
    }
}

export function renderAskReplyText(ask: AgentAsk): string {
    return askPresentationComponent.renderReplyText(ask);
}

export function buildAskMetadata(
    ask: AgentAsk,
    snapshotId: string,
    executiveToolLoop?: GatewayControlLongHorizonLoopSnapshot,
): Record<string, unknown> {
    return askPresentationComponent.buildMetadata(ask, snapshotId, executiveToolLoop);
}
