import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

/**
 * EN: vLLM adapter reusing the OpenAI chat-completions wire format.
 * ZH: 复用 OpenAI chat-completions 线协议的 vLLM 适配器。
 */
export const vllmAdapter: ProtocolAdapter = {
    ...openAIChatCompletionsAdapter,
    name: FModelProtocolName.VLLM,
};
