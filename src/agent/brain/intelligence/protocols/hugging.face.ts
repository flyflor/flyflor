import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

export const huggingFaceAdapter: ProtocolAdapter = {
    ...openAIChatCompletionsAdapter,
    name: FModelProtocolName.HuggingFace,
    defaultPath: '/v1/chat/completions',
    usesV1Fallback: false,
};
