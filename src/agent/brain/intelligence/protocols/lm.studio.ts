import { FModelProtocolName } from '@/config';
import type { ProtocolAdapter } from '../types';
import { openAIChatCompletionsAdapter } from './openai.chat.completions';

export const lmStudioAdapter: ProtocolAdapter = {
    ...openAIChatCompletionsAdapter,
    name: FModelProtocolName.LMStudio,
};
