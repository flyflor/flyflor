import { FModule, Module, Inject, Init } from "@/core";
import { ConfigComponent } from "@/shard/components/config";
import { ContextComponent } from "@/shard/components/context";

interface IPCMessage {
    kind: "user" | "agent" | "error";
    content: string;
}

interface LLMMessage {
    role: "system" | "user" | "assistant";
    content: string;
}

/**
 * The IPC module: external↔kernel boundary via Unix socket / Windows named pipe.
 * Handles bidirectional LLM conversation with real DeepSeek API integration.
 */
@Module()
export class IPCModule extends FModule {
    @Inject() private readonly config!: ConfigComponent;
    @Inject() private readonly context!: ContextComponent;

    private server?: any;
    private llmConfig = {
        baseURL: "https://api.deepseek.com",
        apiKey: "sk-6a4dded5c5ab448581a07b241859835f",
        model: "deepseek-chat", // DeepSeek V4 compatible endpoint
    };

    @Init()
    public async init(): Promise<void> {
        const endpoint = this.config.socketEndpoint;
        const isWindows = process.platform === "win32";

        const handler = {
            open: (socket: any) => {
                console.log(`[IPC] Client connected`);
                this.sendMessage(socket, {
                    kind: "agent",
                    content: "Flyflor ready (DeepSeek V4 Flash). Send: {\"kind\":\"user\",\"content\":\"your message\"}",
                });
            },
            data: async (socket: any, data: any) => {
                const frame = Buffer.from(data).toString("utf8").trim();
                console.log(`[IPC] RX: ${frame}`);

                try {
                    const msg: IPCMessage = JSON.parse(frame);

                    if (msg.kind === "user" && msg.content) {
                        this.context.append("user", msg.content);

                        // 调用真实 LLM (DeepSeek)
                        const response = await this.callDeepSeek(msg.content);

                        this.context.append("agent", response);
                        this.sendMessage(socket, { kind: "agent", content: response });
                    } else {
                        this.sendMessage(socket, {
                            kind: "error",
                            content: 'Invalid format. Use: {"kind":"user","content":"..."}',
                        });
                    }
                } catch (err: any) {
                    console.error(`[IPC] Error:`, err);
                    this.sendMessage(socket, { kind: "error", content: `Error: ${err.message}` });
                }
            },
            close: () => console.log(`[IPC] Client disconnected`),
            error: (_s: any, e: any) => console.error(`[IPC] Socket error:`, e),
        };

        if (isWindows) {
            this.server = Bun.listen({ hostname: "127.0.0.1", port: 17878, socket: handler });
        } else {
            this.server = Bun.listen({ unix: endpoint, socket: handler });
        }

        console.log(`[IPC] Listening at ${endpoint} (DeepSeek V4 Flash)`);
    }

    /**
     * 调用 DeepSeek API (OpenAI 兼容接口，流式输出)
     */
    private async callDeepSeek(userMessage: string): Promise<string> {
        const contextSnapshot = this.context.snapshot();

        // 构建消息历史 (取最近 10 条)
        const messages: LLMMessage[] = [
            {
                role: "system",
                content:
                    "You are Flyflor, an autonomous coding assistant. Be concise, technical, and helpful. Respond in Chinese if the user writes in Chinese.",
            },
        ];

        // 添加历史上下文 (最近 10 条)
        const recentContext = contextSnapshot.slice(-10);
        for (const item of recentContext) {
            messages.push({
                role: item.role === "user" ? "user" : "assistant",
                content: item.content,
            });
        }

        // 添加当前用户消息
        messages.push({ role: "user", content: userMessage });

        try {
            // DeepSeek API (OpenAI 兼容，使用流式输出)
            const response = await fetch(`${this.llmConfig.baseURL}/chat/completions`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Authorization: `Bearer ${this.llmConfig.apiKey}`,
                },
                body: JSON.stringify({
                    model: this.llmConfig.model,
                    messages,
                    stream: true, // 流式输出
                    temperature: 0.7,
                    max_tokens: 2000,
                }),
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`DeepSeek API error: ${response.status} - ${errorText}`);
            }

            // 解析流式响应 (SSE format: data: {...}\n\n)
            const reader = response.body?.getReader();
            if (!reader) throw new Error("No response body");

            const decoder = new TextDecoder();
            let fullContent = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });
                const lines = chunk.split("\n");

                for (const line of lines) {
                    if (line.startsWith("data: ")) {
                        const data = line.slice(6).trim();
                        if (data === "[DONE]") break;

                        try {
                            const parsed = JSON.parse(data);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            if (delta) {
                                fullContent += delta;
                            }
                        } catch (e) {
                            // 忽略解析错误的行
                        }
                    }
                }
            }

            return fullContent || "(DeepSeek returned empty response)";
        } catch (err: any) {
            console.error(`[LLM] DeepSeek API call failed:`, err);
            return `[LLM Error] ${err.message}. Using mock response: 收到你的消息 "${userMessage}"（DeepSeek 暂时不可用）`;
        }
    }

    private sendMessage(socket: any, msg: IPCMessage): void {
        socket.write(JSON.stringify(msg) + "\n");
    }

    public get endpoint(): string {
        return this.config.socketEndpoint;
    }
}
