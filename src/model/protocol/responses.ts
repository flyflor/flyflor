import type { ProtocolAdapter, ProtocolContext, ProviderError } from './types';

/** ZH: 一条 Responses API SSE 事件形状。 EN: One Responses API SSE event shape. */
interface ResponsesEvent {
    type?: string;
    delta?: string;
    error?: ProviderError;
    response?: ResponsesBody;
    message?: string;
    code?: string;
}

/** ZH: parseJson 与终态事件使用的 completed/incomplete Responses 体。 EN: Completed or incomplete Responses body used by parseJson and terminal events. */
interface ResponsesBody {
    status?: string;
    output_text?: unknown;
    output?: unknown;
    error?: ProviderError;
    incomplete_details?: { reason?: unknown };
}

/**
 * ZH: OpenAI Responses 线适配器；纯文本，tools:false 使 fetch 前拒绝工具。
 * EN: OpenAI Responses wire adapter; text-only, rejects tools before fetch via tools:false.
 */
export const responsesAdapter: ProtocolAdapter = {
    name: 'responses',
    tools: false,
    body: (context: ProtocolContext) => ({
        model: context.config.model,
        input: context.messages.filter((message) => message.role !== 'tool').map((message) => ({ role: message.role, content: message.content })),
        stream: true,
        max_output_tokens: context.config.maxTokens,
    }),
    parseJson: (body) => {
        if (typeof body !== 'object' || body === null || Array.isArray(body)) throw Error('Responses JSON root is invalid');
        const response = body as ResponsesBody;
        if (response.status === 'failed') throw Error(errorMessage(response.error, 'Responses request failed'));
        if (response.status === 'incomplete') {
            const stopReason = incomplete(response.incomplete_details?.reason);
            return { text: responseText(response), stopReason };
        }
        if (response.status !== 'completed') throw Error(`Responses status is unsupported: ${String(response.status)}`);
        return { text: responseText(response), stopReason: 'stop' };
    },
    parse: (controller, line) => {
        const data = sseData(line);
        if (data === undefined) return false;
        const parsed = JSON.parse(data) as ResponsesEvent;
        if (parsed.type === 'response.output_text.delta') {
            if (parsed.delta) controller.enqueue({ type: 'text_delta', text: parsed.delta });
        } else if (parsed.type === 'response.completed') {
            if (parsed.response) assertNoRefusal(parsed.response);
            controller.enqueue({ type: 'done', stopReason: 'stop' });
            return true;
        } else if (parsed.type === 'response.incomplete') {
            controller.enqueue({ type: 'done', stopReason: incomplete(parsed.response?.incomplete_details?.reason) });
            return true;
        } else if (parsed.type === 'response.refusal.delta' || parsed.type === 'response.refusal.done') {
            throw Error(`Responses refusal: ${parsed.delta ?? parsed.message ?? parsed.type}`);
        } else if (parsed.type === 'response.failed' || parsed.type === 'error') {
            throw Error(errorMessage(parsed.error ?? parsed.response?.error, 'Responses stream error', parsed.message, parsed.code));
        }
        return false;
    },
};

/** ZH: 将 incomplete reason 映射为 length，否则 reject。 EN: Maps incomplete reason to StopReason length or rejects. */
function incomplete(reason: unknown): 'length' {
    if (reason === 'max_output_tokens') return 'length';
    throw Error(`Responses incomplete reason is unsupported: ${String(reason)}`);
}

/** ZH: 从 completed Responses 体提取纯文本。 EN: Extracts plain text from a completed Responses body. */
function responseText(root: ResponsesBody): string {
    assertNoRefusal(root);
    if (typeof root.output_text === 'string') return root.output_text;
    const parts: string[] = [];
    if (Array.isArray(root.output)) {
        for (const output of root.output) {
            const content = (output as { content?: unknown }).content;
            if (!Array.isArray(content)) continue;
            for (const item of content) {
                const responseItem = item as { text?: unknown };
                const text = responseItem.text;
                if (typeof text === 'string') parts.push(text);
            }
        }
    }
    if (parts.length === 0) throw Error('Responses JSON did not include text');
    return parts.join('');
}

/** ZH: Responses 体含 refusal 字符串时 reject。 EN: Rejects when the Responses body embeds a refusal string. */
function assertNoRefusal(root: ResponsesBody): void {
    if (!Array.isArray(root.output)) return;
    for (const output of root.output) {
        const content = (output as { content?: unknown }).content;
        if (!Array.isArray(content)) continue;
        for (const item of content) {
            const refusal = (item as { refusal?: unknown }).refusal;
            if (typeof refusal === 'string') throw Error(`Responses refusal: ${refusal}`);
        }
    }
}

/** ZH: 提取 SSE data 负载；忽略非 data 行。 EN: Extracts SSE data payload; ignores non-data lines. */
function sseData(line: string): string | undefined {
    const trimmed = line.trim();
    return trimmed.startsWith('data:') ? trimmed.slice('data:'.length).trim() : undefined;
}

/** ZH: 将 Responses 错误字段格式化为一条 reject 消息。 EN: Formats Responses error fields into one reject message. */
function errorMessage(error: ProviderError | undefined, fallback: string, message?: string, code?: string): string {
    const resolvedMessage = message ?? error?.message ?? error?.type;
    const resolvedCode = code ?? error?.code;
    return [resolvedCode, resolvedMessage].filter(Boolean).join(': ') || fallback;
}
