import { FAgent, Provide, Scope } from '@/core';
import { Inference, type InferenceResult, type InferenceToolDefinition, type ProviderMessage } from '@/inference';

/**
 * EN: One agent's inference boundary. It returns only visible text and structured action requests.
 * ZH: 单个 Agent 的推理边界；只返回可见文本和结构化动作请求。
 */
@Provide()
export class Thought extends FAgent {
    @Scope()
    public inference!: Inference;

    public async think(
        messages: ProviderMessage[],
        tools: InferenceToolDefinition[],
        onText: (chunk: string) => void,
        signal: AbortSignal,
    ): Promise<InferenceResult> {
        if (signal.aborted) throw signal.reason ?? Error('Thought aborted');
        return await this.inference.streamRequest(messages, tools, onText, signal);
    }
}
