import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

export const vllmAdapter: ProtocolAdapter = {
    ...openAIChatCompletionsAdapter,
    name: FModelProtocolName.VLLM,
    defaultPath: '/v1/chat/completions',
    auth: 'optionalBearer',
    usesV1Fallback: false,
};
