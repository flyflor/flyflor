import { Component } from "../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../components/index.ts";
import type { AgentAsk } from "../../../protocol/contracts/index.ts";
import type { GatewayControlLongHorizonLoopSnapshot } from "../../../protocol/control/index.ts";
import { AskLedgerComponent, askLedgerComponent } from "./ledger.ts";
import { AskNormalizer, askNormalizer } from "./normalizer.ts";
import { AskParser, askParser, type ParsedAgentAsk } from "./parser.ts";
import { AskPresentationComponent, askPresentationComponent } from "./presentation.ts";

/**
 * ASK component is the single owner for parse, normalize, present, and ledger-facing hooks.
 */
@Component()
export class AskComponent extends MemoryComponent {
    public constructor(
        private readonly parser: AskParser = askParser,
        private readonly normalizer: AskNormalizer = askNormalizer,
        private readonly presentation: AskPresentationComponent = askPresentationComponent,
        private readonly ledger: AskLedgerComponent = askLedgerComponent,
    ) {
        super();
    }

    public parse(rawText: string): ParsedAgentAsk {
        return this.parser.parse(rawText);
    }

    public normalizePayload(payload: unknown): AgentAsk {
        return this.normalizer.normalizePayload(payload);
    }

    public renderReplyText(ask: AgentAsk): string {
        return this.presentation.renderReplyText(ask);
    }

    public buildMetadata(
        ask: AgentAsk,
        snapshotId: string,
        executiveToolLoop?: GatewayControlLongHorizonLoopSnapshot,
    ): Record<string, unknown> {
        return this.presentation.buildMetadata(ask, snapshotId, executiveToolLoop);
    }

    public readCrystalCandidates(ask: AgentAsk): Record<string, unknown>[] {
        return this.ledger.readCrystalCandidates(ask);
    }
}

export const askComponent = new AskComponent();
