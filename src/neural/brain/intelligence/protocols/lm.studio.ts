import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

/**
 * EN: LM Studio adapter reusing the OpenAI chat-completions wire format.
 * ZH: 复用 OpenAI chat-completions 线协议的 LM Studio 适配器。
 */
export const lmStudioAdapter: ProtocolAdapter = {
    ...openAIChatCompletionsAdapter,
    name: FModelProtocolName.LMStudio,
};
