import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

/**
 * EN: Hugging Face adapter reusing the OpenAI chat-completions wire format.
 * ZH: 复用 OpenAI chat-completions 线协议的 Hugging Face 适配器。
 */
export const huggingFaceAdapter: ProtocolAdapter = {
    ...openAIChatCompletionsAdapter,
    name: FModelProtocolName.HuggingFace,
};
