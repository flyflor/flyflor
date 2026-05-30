import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { Service } from "../di";
import { ConfigService } from "../config/config.service";
import { AgentRuntimeService } from "../kernel";
import type { ChatMessagePayload, SocketEnvelope, SocketServerOptions } from "./socket.types";

/**
 * Adapts Bun native WebSocket traffic to the Flyflor kernel.
 *
 * @usage CLI entrypoint starts this service; tests can start it on an isolated port.
 */
@Service()
export class SocketServerService {
  private server?: ReturnType<typeof Bun.serve>;
  private readonly subscriptions: readonly { readonly unsubscribe: () => void }[];

  public constructor(
    private readonly configService = new ConfigService(),
    private readonly runtime = new AgentRuntimeService(configService),
  ) {
    this.subscriptions = this.attachRuntimeBroadcasts();
  }

  /**
   * Starts the Bun WebSocket server.
   *
   * @param options - Optional host/port overrides.
   * @returns Bun server handle.
   * @usage `bun run src/index.ts --serve` calls this for local testing.
   */
  public start(options: SocketServerOptions = {}): ReturnType<typeof Bun.serve> {
    const config = this.configService.getConfig();
    const host = options.host ?? config.socket.host;
    const port = options.port ?? config.socket.port;
    const testPagePath = this.configService.resolve(config.paths.socketTestPage);
    this.server = this.serveWithPortRetry(host, port, testPagePath);
    return this.server;
  }

  /**
   * Starts Bun.serve, retrying explicit high ports when the caller asked for an ephemeral port.
   *
   * @param host - Hostname to bind.
   * @param port - Configured port; `0` means choose an available local port.
   * @param testPagePath - Absolute HTML test page path.
   * @returns Bun server handle.
   * @usage Bun's test runner can reject `port: 0`, so scenario tests use bounded explicit candidates.
   */
  private serveWithPortRetry(host: string, port: number, testPagePath: string): ReturnType<typeof Bun.serve> {
    let lastError: unknown;
    for (const candidate of this.listenCandidates(host, port)) {
      try {
        return this.createServer(candidate.host, candidate.port, testPagePath);
      } catch (error) {
        lastError = error;
        if (port !== 0 || !this.isAddressInUse(error)) {
          throw error;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Creates the Bun native HTTP/WebSocket server for one concrete port.
   *
   * @param host - Hostname to bind.
   * @param port - Concrete port to bind.
   * @param testPagePath - Absolute HTML test page path.
   * @returns Bun server handle.
   * @usage `serveWithPortRetry` owns port selection while this method owns adapter wiring.
   */
  private createServer(host: string | undefined, port: number, testPagePath: string): ReturnType<typeof Bun.serve> {
    return Bun.serve<{ readonly clientId: string }>({
      ...(host ? { hostname: host } : {}),
      port,
      fetch: (request, server) => {
        const url = new URL(request.url);
        if (url.pathname === "/ws") {
          const upgraded = server.upgrade(request, { data: { clientId: randomUUID() } });
          return upgraded ? undefined : new Response("WebSocket upgrade failed", { status: 400 });
        }
        if (url.pathname === "/" || url.pathname === "/socket-test.html") {
          if (!existsSync(testPagePath)) {
            return new Response("socket test page not found", { status: 404 });
          }
          return new Response(readFileSync(testPagePath), {
            headers: { "content-type": "text/html; charset=utf-8" },
          });
        }
        return new Response("not found", { status: 404 });
      },
      websocket: {
        open: (ws) => {
          ws.subscribe("runtime");
          ws.send(JSON.stringify(this.envelope("agent.event", { status: "connected", clientId: ws.data.clientId })));
        },
        message: async (ws, message) => {
          try {
            const envelope = this.parseEnvelope(message);
            if (envelope.type !== "chat.message") {
              ws.send(JSON.stringify(this.envelope("agent.error", { error: `unsupported type: ${envelope.type}` })));
              return;
            }
            const payload = envelope.payload as ChatMessagePayload;
            if (!this.isChatMessagePayload(payload)) {
              ws.send(JSON.stringify(this.envelope("agent.error", { error: "invalid chat.message payload" })));
              return;
            }
            const result = await this.runtime.runTurn(payload);
            ws.send(JSON.stringify(this.envelope("chat.turn.complete", {
              conversationId: result.conversationId,
              turnId: result.turnId,
              toolResults: result.toolResults,
            })));
          } catch (error) {
            ws.send(JSON.stringify(this.envelope("agent.error", { error: error instanceof Error ? error.message : String(error) })));
          }
        },
        close: (ws) => {
          ws.unsubscribe("runtime");
        },
      },
    });
  }

  /**
   * Stops the Bun WebSocket server and signal subscriptions.
   *
   * @returns Nothing.
   * @usage Tests call this during teardown.
   */
  public stop(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }
    this.server?.stop(true);
    this.server = undefined;
  }

  /**
   * Returns the runtime used by this socket service.
   *
   * @returns AgentRuntimeService instance.
   * @usage Scenario tests inspect signal events through the runtime.
   */
  public getRuntime(): AgentRuntimeService {
    return this.runtime;
  }

  /**
   * Subscribes runtime SignalBus events and broadcasts them to socket clients.
   *
   * @returns Subscription handles for teardown.
   * @usage Keeps SocketModule as an adapter, not business logic owner.
   */
  private attachRuntimeBroadcasts(): readonly { readonly unsubscribe: () => void }[] {
    const bus = this.runtime.getSignalBus();
    const types = [
      "chat.delta",
      "chat.final",
      "memory.store",
      "memory.recall",
      "model.reasoning",
      "model.tool_call",
      "context.ready",
      "context.compacted",
      "plugin.availability",
      "plugin.diagnostic",
      "plugin.unavailable",
      "plugin.failed",
      "recovery.scan",
      "workmux.task.requested",
      "tool.call",
      "tool.started",
      "tool.result",
      "tool.completed",
      "tool.failed",
      "tool.error",
      "tool.artifact",
      "guard.ask",
      "guard.answer",
    ];
    return types.map((type) => bus.subscribe(type, async (payload) => {
      this.server?.publish("runtime", JSON.stringify(this.envelope(type, payload)));
    }));
  }

  /**
   * Parses a WebSocket inbound message.
   *
   * @param message - Raw Bun WebSocket message.
   * @returns Parsed protocol envelope.
   * @usage Rejects malformed traffic before reaching the kernel.
   */
  private parseEnvelope(message: string | Buffer): SocketEnvelope {
    const text = typeof message === "string" ? message : message.toString("utf8");
    const parsed = JSON.parse(text) as Partial<SocketEnvelope>;
    if (!parsed.id || !parsed.type || typeof parsed.payload !== "object") {
      throw new Error("invalid socket envelope");
    }
    return parsed as SocketEnvelope;
  }

  /**
   * Checks whether an inbound payload is a valid chat request.
   *
   * @param payload - Unknown parsed payload.
   * @returns True when payload contains a conversation id and content.
   * @usage Socket message handling validates input before calling the kernel.
   */
  private isChatMessagePayload(payload: unknown): payload is ChatMessagePayload {
    return typeof payload === "object"
      && payload !== null
      && typeof (payload as Partial<ChatMessagePayload>).conversationId === "string"
      && typeof (payload as Partial<ChatMessagePayload>).content === "string";
  }

  /**
   * Creates a server envelope.
   *
   * @typeParam TPayload - Payload shape.
   * @param type - Event type.
   * @param payload - JSON payload.
   * @returns Socket protocol envelope.
   * @usage All outgoing messages pass through this helper for consistency.
   */
  private envelope<TPayload>(type: string, payload: TPayload): SocketEnvelope<TPayload> {
    return {
      id: randomUUID(),
      type,
      payload,
      timestamp: Date.now(),
    };
  }

  /**
   * Builds concrete host and port pairs to try for a requested listen endpoint.
   *
   * @param host - Requested bind host from config or start options.
   * @param port - Requested port from config or start options.
   * @returns One endpoint or bounded retry candidates for `0`.
   * @usage Keeps tests from depending on one Bun ephemeral-port binding path.
   */
  private listenCandidates(host: string, port: number): readonly { readonly host?: string; readonly port: number }[] {
    if (port !== 0) {
      return [{ host, port }];
    }
    const base = 20_000 + ((process.pid * 131 + Date.now()) % 30_000);
    const explicitPorts = Array.from({ length: 25 }, (_, index) => 20_000 + ((base + index) % 30_000));
    return [
      { port: 0 },
      ...explicitPorts.map((candidatePort) => ({ host, port: candidatePort })),
      ...explicitPorts.map((candidatePort) => ({ host: "localhost", port: candidatePort })),
    ];
  }

  /**
   * Checks whether a Bun.serve error came from a busy address.
   *
   * @param error - Unknown thrown value.
   * @returns True when the error code indicates address/port reuse.
   * @usage Ephemeral port retry should only hide expected bind collisions.
   */
  private isAddressInUse(error: unknown): boolean {
    if (typeof error === "object" && error !== null && (error as { readonly code?: unknown }).code === "EADDRINUSE") {
      return true;
    }
    return error instanceof Error && (error.message.includes("EADDRINUSE") || error.message.includes("in use"));
  }
}
