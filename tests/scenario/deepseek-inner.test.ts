import { existsSync, readFileSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { ConfigService } from "../../src/config/config.service";
import { ContextBuilderService } from "../../src/context";
import { AgentRuntimeService } from "../../src/kernel";
import { MemoryComponent } from "../../src/memory";
import { SignalBus } from "../../src/signal";

/**
 * Describes one event observed during the DeepSeek inner test.
 *
 * @property type - SignalBus event type.
 * @property payload - Event payload emitted by runtime or tools.
 * @usage The inner test inspects events to prove tool exploration happened.
 */
interface ObservedEvent {
  readonly type: string;
  readonly payload: unknown;
}

loadLocalEnv();
const innerConfig = new ConfigService();
const hasDeepSeekCredential = Boolean(innerConfig.getProvider("deepseek")?.api_key);

if (!hasDeepSeekCredential) {
  console.warn("DeepSeek credentials are not configured; skipping real-model inner scenario.");
}

describe("DeepSeek inner scenario", () => {
  test.skipIf(!hasDeepSeekCredential)("uses real model with project inspection when credentials are configured", async () => {
    const config = innerConfig;
    const targetProject = "/Users/yihuaqing/Desktop/yihuaqing/flyflors/flyflor-front";
    expect(config.getConfig().model.provider).toBe("deepseek");
    expect(existsSync(targetProject)).toBe(true);
    expect(config.getProvider("deepseek")?.api_key.length ?? 0).toBeGreaterThan(0);

    const memory = new MemoryComponent(config);
    const signalBus = new SignalBus(true);
    const events: ObservedEvent[] = [];
    for (const type of ["tool.call", "tool.result", "memory.recall", "chat.final"]) {
      signalBus.subscribe(type, async (payload) => {
        events.push({ type, payload });
      });
    }
    const runtime = new AgentRuntimeService(
      config,
      memory,
      new ContextBuilderService(config, undefined, memory),
      signalBus,
    );
    const result = await runtime.runTurn({
      conversationId: `inner-${Date.now()}`,
      content: `仔细阅读这个项目 ${targetProject} 说说你的看法`,
    });
    expect(result.toolResults.length).toBeGreaterThanOrEqual(4);
    expect(events.filter((event) => event.type === "tool.call").length).toBeGreaterThanOrEqual(4);
    expect(result.context.recall.length).toBe(0);
    expect(result.assistantMessage.length).toBeGreaterThan(20);
    expect(result.assistantMessage).not.toContain("已结合本地记忆处理");
  }, 120_000);
});

/**
 * Loads ignored local environment files for inner tests.
 *
 * @returns Nothing.
 * @usage Allows `.env.local` or `.env` to provide `DEEPSEEK_API_KEY` without committing secrets.
 */
function loadLocalEnv(): void {
  for (const fileName of [".env.local", ".env"]) {
    if (!existsSync(fileName)) {
      continue;
    }
    for (const line of readFileSync(fileName, "utf8").split("\n")) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.+?)\s*$/);
      if (!match?.[1] || !match[2] || process.env[match[1]]) {
        continue;
      }
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  }
}
