import { FModelProtocolName } from '@/configuration';
import type { ProtocolAdapter, ProtocolBuildContext, ProviderErrorShape } from '../types';

/**
 * EN: Minimal shape of one OpenAI Responses stream event.
 * ZH: 单个 OpenAI Responses 流式事件的最小形态。
 */
interface ResponsesEvent {
    /** EN: Event type label. ZH: 事件类型标签。 */
    type?: string;
    /** EN: Text delta payload. ZH: 文本增量负载。 */
    delta?: string;
    /** EN: Top-level error payload. ZH: 顶层错误负载。 */
    error?: ProviderErrorShape;
    /** EN: Nested response object that may carry an error. ZH: 可能携带错误的内嵌 response 对象。 */
    response?: {
        error?: ProviderErrorShape;
    };
    /** EN: Flat error message field. ZH: 平铺的错误消息字段。 */
    message?: string;
    /** EN: Flat error code field. ZH: 平铺的错误码字段。 */
    code?: string;
}

/**
 * EN: Protocol adapter for the OpenAI Responses SSE wire format.
 * ZH: OpenAI Responses SSE 线协议适配器。
 */
export const openAIResponsesAdapter: ProtocolAdapter = {
    name: FModelProtocolName.OpenAIResponses,
    body: (context: ProtocolBuildContext) => ({
        model: context.model,
        input: context.messages.filter((message) => message.role !== 'action').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_output_tokens: context.maxTokens,
    }),
    parseLine: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as ResponsesEvent;
        if (parsed.type === 'response.output_text.delta') {
            if (typeof parsed.delta === 'string' && parsed.delta.length > 0) controller.enqueue({ type: 'text_delta', text: parsed.delta });
            return false;
        }
        if (parsed.type === 'response.completed' || parsed.type === 'response.incomplete') {
            controller.enqueue({ type: 'done', stopReason: parsed.type === 'response.incomplete' ? 'length' : 'stop' });
            return true;
        }
        if (parsed.type === 'response.failed' || parsed.type === 'error') {
            throw Error(providerErrorMessage(parsed.error ?? parsed.response?.error, 'LLM provider Responses stream error', parsed.message, parsed.code));
        }
        return false;
    },
};

/**
 * EN: Extracts the JSON payload from one SSE `data:` line.
 * ZH: 从一行 SSE `data:` 中提取 JSON 负载。
 */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    if (trimmed.length === 0 || !trimmed.startsWith('data:')) return undefined;
    return trimmed.slice('data:'.length).trim();
}

/**
 * EN: Formats a Responses-stream error payload into one readable message.
 * ZH: 把 Responses 流式错误负载格式化为一条可读消息。
 */
function providerErrorMessage(error: ProviderErrorShape | undefined, fallback: string, message?: string, code?: string): string {
    const resolvedMessage = message ?? error?.message ?? error?.type;
    const resolvedCode = code ?? error?.code;
    return [resolvedCode, resolvedMessage].filter(Boolean).join(': ') || fallback;
}
