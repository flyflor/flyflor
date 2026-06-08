import { FileService, FService, Inject, Logger, Prompt, Service, useContainer, type FLogger } from '@/core';
import { ConfigComponent, type FAgentProfileConfiguration } from '@/config';
import { ROOT_PATH } from '@/config';
import { CodeGraphPlugin, GlobPlugin, GrepPlugin, ReadFilePlugin, RtkPlugin, type InvestigationObservation, type InvestigationObserveContext, type InvestigationObserveRequest, type InvestigationPipePlugin, type InvestigationSourcePlugin } from '@/plugins/tools';
import { AgentChatRole, Intelligence } from '../intelligence';
import type { BrainInvestigationRequest, BrainInvestigationResult, BrainInvestigationState } from './types';

const MAX_INVESTIGATION_TOOL_ROUNDS = 5;
const INVESTIGATION_LOG_PREVIEW_LENGTH = 160;

@Service()
export class Investigation extends FService {
    @Logger(Investigation.name)
    public readonly log!: FLogger;

    @Prompt('agent/INVESTIGATION.md')
    public prompt!: FileService<string>;

    public constructor(public readonly config: FAgentProfileConfiguration) {
        super();
    }
}
