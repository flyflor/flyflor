import { Plugin, FPlugin, Inject, Init } from '@/core';
import { ConfigComponent, type MCPConfig } from '@/shard/components/config';

/**
 * One tool exposed by a connected MCP server.
 * - `server`: the server name the tool belongs to.
 * - `name`: the tool's invocation name.
 * - `description`: human-readable summary.
 * - `inputSchema`: JSON Schema describing the tool's arguments.
 */
export interface MCPTool {
    server: string;
    name: string;
    description: string;
    inputSchema: unknown;
}

/** A JSON-RPC request/response envelope used over the MCP stdio transport. */
interface JsonRpcMessage {
    jsonrpc: '2.0';
    id?: number;
    method?: string;
    params?: unknown;
    result?: any;
    error?: { code: number; message: string };
}

/**
 * The MCP (Model Context Protocol) plugin: connects to configured MCP servers and aggregates their tools.
 *
 * Supports the stdio transport (spawn a process, speak newline-delimited JSON-RPC). Performs the MCP
 * handshake (`initialize`) then `tools/list`, and can `callTool`. Honest: no servers configured ⇒ no tools.
 * http/sse transport is recognized in config but not yet implemented (logged, skipped).
 */
@Plugin()
export class MCPComponent extends FPlugin {
    @Inject() private readonly config!: ConfigComponent;

    /** Aggregated tools across all connected servers. */
    private tools: MCPTool[] = [];
    /** Live server processes, keyed by server name. */
    private readonly processes = new Map<string, ReturnType<typeof Bun.spawn>>();
    /** Per-server monotonically increasing JSON-RPC id. */
    private nextId = 1;

    /**
     * Connects to every configured MCP server at startup and lists their tools.
     */
    @Init()
    public async init(): Promise<void> {
        const servers = this.config.mcp?.servers ?? {};
        for (const [name, cfg] of Object.entries(servers)) {
            try {
                await this.connect(name, cfg);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                console.error(`[MCP] server '${name}' failed: ${message}`);
            }
        }
        console.log(`[MCP] ${this.processes.size} server(s), ${this.tools.length} tool(s)`);
    }

    /**
     * Lists every tool exposed by connected servers.
     * @returns a copy of the aggregated tool list.
     */
    public listTools(): MCPTool[] {
        return [...this.tools];
    }

    /**
     * Calls a tool on its server via JSON-RPC `tools/call`.
     * @param server - the server name.
     * @param tool - the tool name.
     * @param args - the tool arguments (must match its inputSchema).
     * @returns the tool result payload.
     */
    public async callTool(server: string, tool: string, args: unknown): Promise<unknown> {
        const proc = this.processes.get(server);
        if (proc === undefined) {
            throw Object.assign(new Error('MCP server not connected'), { detail: { server } });
        }
        const response = await this.rpc(proc, 'tools/call', { name: tool, arguments: args });
        return response.result;
    }

    /**
     * Spawns a stdio MCP server, performs the handshake, and records its tools.
     * @param name - the server name.
     * @param cfg - the server config (stdio fields used; http/sse skipped for now).
     */
    private async connect(name: string, cfg: MCPConfig): Promise<void> {
        if (cfg.command === undefined) {
            console.log(`[MCP] server '${name}' has no stdio command (http/sse not yet implemented) — skipped`);
            return;
        }
        const proc = Bun.spawn([cfg.command, ...(cfg.args ?? [])], {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'inherit',
            env: { ...process.env, ...cfg.env },
        });
        this.processes.set(name, proc);

        await this.rpc(proc, 'initialize', {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'flyflor', version: '0.1.0' },
        });

        const listed = await this.rpc(proc, 'tools/list', {});
        const toolList: Array<{ name: string; description?: string; inputSchema?: unknown }> = listed.result?.tools ?? [];
        for (const tool of toolList) {
            this.tools.push({
                server: name,
                name: tool.name,
                description: tool.description ?? '',
                inputSchema: tool.inputSchema ?? {},
            });
        }
    }

    /**
     * Sends one JSON-RPC request over a server's stdio and awaits the matching response.
     * Uses newline-delimited JSON (MCP stdio framing). Sequential by construction (await per call).
     * @param proc - the spawned server process.
     * @param method - the JSON-RPC method.
     * @param params - the method params.
     * @returns the response message.
     */
    private async rpc(proc: ReturnType<typeof Bun.spawn>, method: string, params: unknown): Promise<JsonRpcMessage> {
        const id = this.nextId++;
        const request: JsonRpcMessage = { jsonrpc: '2.0', id, method, params };

        const stdin = proc.stdin as { write: (s: string) => void; flush: () => void } | undefined;
        const stdout = proc.stdout as ReadableStream<Uint8Array> | undefined;
        if (stdin === undefined || stdout === undefined) {
            throw new Error('MCP server has no stdio pipes');
        }
        stdin.write(JSON.stringify(request) + '\n');
        stdin.flush();

        const reader = stdout.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    throw new Error(`MCP server closed before responding to '${method}'`);
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() ?? '';
                for (const line of lines) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        continue;
                    }
                    const message = JSON.parse(trimmed) as JsonRpcMessage;
                    if (message.id === id) {
                        if (message.error) {
                            throw Object.assign(new Error(message.error.message), { detail: message.error });
                        }
                        return message;
                    }
                    // ignore notifications / unrelated ids
                }
            }
        } finally {
            reader.releaseLock();
        }
    }
}
