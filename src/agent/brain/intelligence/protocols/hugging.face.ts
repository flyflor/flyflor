import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

export const huggingFaceAdapter: ProtocolAdapter = {
    ...openAIChatCompletionsAdapter,
    name: FModelProtocolName.HuggingFace,
};
