import { createChannelAdapters, GatewayServer } from "./src/gateway/index.ts";
import { createModelClient } from "./src/modules/llm/openai.ts";
import { startHumanChat } from "./src/runtime/chat.ts";
import { AgentRuntime } from "./src/runtime/index.ts";
import { loadConfig } from "./src/config/index.ts";
import { RuntimeMode } from "./src/shared/core/enums.ts";
import { ConsoleEventSink, NullEventSink } from "./src/shared/events/index.ts";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log("flyflor 0.1.0");
    process.exit(0);
}

const config = await loadConfig();
const mode = process.argv[2] ?? RuntimeMode.Chat;
const events = mode === RuntimeMode.Gateway ? new ConsoleEventSink() : new NullEventSink();
const model = createModelClient(config.model);
const runtime = new AgentRuntime(config, model, events);
const adapters = createChannelAdapters(config.gateway);

if (mode === RuntimeMode.Gateway) {
    new GatewayServer(config.gateway, adapters, runtime, events).start();
} else {
    await startHumanChat(runtime);
}
