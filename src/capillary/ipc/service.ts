import { FService, Inject, Service } from "@/core";
import { ContextComponent } from "@/shard/components/context";

/**
 * One IPC message exchanged with a client (CLI, Web, or future Rust TUI).
 * - `kind`: `user` (inbound request), `agent` (LLM reply), or `error`.
 * - `content`: the message text.
 */
export interface IPCMessage {
    kind: "user" | "agent" | "error";
    content: string;
}

/**
 * One message in the LLM chat history (OpenAI-compatible shape).
 */
interface LLMMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * The IPC conversation service: the shared brain behind every transport (unix socket + WebSocket).
 *
 * It owns the DeepSeek V4 Flash call (OpenAI-compatible, streaming) and context tracking, so the socket and
 * WebSocket front-ends stay thin: they hand a user message in and get an agent reply out.
 */
@Service()
export class IPCService extends FService {
    @Inject() private readonly context!: ContextComponent;

    private readonly llm = {
        baseURL: "https://api.deepseek.com",
        apiKey: "sk-6a4dded5c5ab448581a07b241859835f",
        model: "deepseek-chat",
    };

    /**
     * Handles one user turn: records it, calls the model, records the reply, returns it.
     * @param userMessage - the user's text.
     * @returns the agent's reply text.
     */
    public async handleUserMessage(userMessage: string): Promise<string> {
        this.context.append("user", userMessage);
        const reply = await this.callDeepSeek(userMessage);
        this.context.append("agent", reply);
        return reply;
    }

    /**
     * Calls DeepSeek (OpenAI-compatible, streaming) with the recent context window.
     * @param userMessage - the latest user message.
     * @returns the assembled streamed reply, or a fallback string on error.
     */
    private async callDeepSeek(userMessage: string): Promise<string> {
        const recent = this.context.snapshot().slice(-10);
        const messages: LLMMessage[] = [
            {
                role: "system",
                content:
                    "You are Flyflor, an autonomous coding assistant. Be concise, technical, and helpful. " +
                    "Respond in Chinese when the user writes in Chinese.",
            },
            ...recent.map((item) => ({
                role: (item.role === "user" ? "user" : "assistant") as "user" | "assistant",
                content: item.content,
            })),
            { role: "user", content: userMessage },
        ];

        try {
            const response = await fetch(`${this.llm.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.llm.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.llm.model,
                    messages,
                    stream: true,
                    temperature: 0.7,
                    max_tokens: 2000,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`DeepSeek API ${response.status}: ${errorText}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("No response body");
            }

            const decoder = new TextDecoder();
            let full = "";
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() ?? "";
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed.startsWith("data:")) {
                        continue;
                    }
                    const data = trimmed.slice(5).trim();
                    if (data === "[DONE]") {
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const delta = parsed.choices?.[0]?.delta?.content;
                        if (typeof delta === "string") {
                            full += delta;
                        }
                    } catch {
                        // ignore non-JSON keep-alive lines
                    }
                }
            }

            return full || "(DeepSeek returned an empty response)";
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error(`[LLM] DeepSeek call failed:`, message);
            return `[LLM Error] ${message}`;
        }
    }
}
