import { Component } from "../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../components/index.ts";
import type { AgentAsk } from "../../../protocol/contracts/index.ts";

/**
 * ASK ledger boundary.
 *
 * Phase 3 introduces the owner so later durable job / brain.db work can attach
 * writes here without scattering ask evidence handling through RuntimeModule.
 */
@Component()
export class AskLedgerComponent extends MemoryComponent {
    public readCrystalCandidates(ask: AgentAsk): Record<string, unknown>[] {
        return ask.crystalCandidates ?? [];
    }
}

export const askLedgerComponent = new AskLedgerComponent();
