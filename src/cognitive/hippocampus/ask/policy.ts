import { Component } from "../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../components/index.ts";
import {
    AskAuthority,
    AskResumePolicy,
    AskSource,
    type AgentAsk,
} from "../../../protocol/contracts/index.ts";

/**
 * ASK policy owns protocol defaults that are not model semantics.
 *
 * The component only consumes explicit structured fields and enum membership;
 * it never infers intent from user-visible text.
 */
@Component()
export class AskPolicyComponent extends MemoryComponent {
    public normalize(ask: AgentAsk): AgentAsk {
        return {
            ...ask,
            authority: ask.authority ?? this.defaultAuthorityForSource(ask.source),
            source: ask.source ?? AskSource.Model,
            resumePolicy: ask.resumePolicy ?? AskResumePolicy.Continue,
        };
    }

    private defaultAuthorityForSource(source: AgentAsk["source"]): AgentAsk["authority"] {
        switch (source) {
            case AskSource.Blackboard:
                return AskAuthority.Blackboard;
            case AskSource.Crystal:
                return AskAuthority.Crystal;
            case AskSource.Constitution:
                return AskAuthority.Constitutional;
            case AskSource.Executive:
            case AskSource.ToolStability:
                return AskAuthority.Executive;
            case AskSource.Fork:
            case AskSource.Model:
            case AskSource.Scope:
            case undefined:
                return AskAuthority.Normal;
        }
    }
}

export const askPolicyComponent = new AskPolicyComponent();
