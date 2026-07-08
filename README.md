# Flyflor

Flyflor is a Bun + TypeScript agent kernel. The current codebase is built around decorated classes, a reflect-metadata IOC container, a local length-prefixed IPC socket, prompt packages, provider protocol adapters, and a small local tool surface.

## Quick Start

```bash
bun install
export DEEPSEEK_API_KEY=...
bun run dev
bun run client
```

`bun run dev` starts `src/bootstrap.ts` and opens the configured IPC socket. `bun run client` serves the local browser bridge at `http://127.0.0.1:17878` and forwards browser JSON messages to that socket.

Use these checks before calling a change healthy:

```bash
bun run check
bun test
bun run build:binary
```

`bun run check` runs TypeScript and the repository red-line scanner. The default model/provider lives in `.config/config.jsonc`; secrets stay in environment variables.

## Runtime Map

```mermaid
flowchart TB
    Bootstrap["src/bootstrap.ts<br/>loads reflect-metadata first"] --> Factory["Factory.create(AppModule)"]
    Factory --> Container["Container<br/>constructs, injects, runs @Init"]
    Container --> AppModule["AppModule<br/>imports Synapse + PluginModule"]

    AppModule --> Synapse["Synapse<br/>signal cortex + active agent pool"]
    AppModule --> PluginModule["PluginModule"]
    PluginModule --> Tools["ToolComponent<br/>ask, confirm, filesystem, shell, execute"]

    Synapse --> Socket["FSocket<br/>Bun IPC listener"]
    Socket <--> Packet["IPCPacket<br/>8-byte length + JSON"]
    Socket <--> Client["web/client.ts<br/>browser bridge"]

    Synapse --> Agent["Agent<br/>scoped Brain + Memory"]
    Agent --> Brain["Brain<br/>turn orchestration"]
    Brain --> Callosum["Callosum<br/>route classifier"]
    Brain --> Context["Context<br/>turns + summaries"]
    Brain --> Memory["Memory<br/>private agent notes"]
    Brain --> Investigation["Investigation<br/>local action loop"]
    Brain --> Intelligence["Intelligence<br/>provider stream boundary"]
    Context --> Intelligence
    Investigation --> Tools
    Investigation --> Intelligence
    Intelligence --> Protocols["Protocol adapters<br/>OpenAI, Anthropic, Gemini, Bedrock,<br/>Cohere, HuggingFace, Ollama, vLLM, LM Studio"]
```

## Boot Lifecycle

```mermaid
flowchart LR
    A["bootstrap.ts"] --> B["import reflect-metadata"]
    B --> C["Factory.create(AppModule)"]
    C --> D["Container.getAsync(AppModule)"]
    D --> E["build module imports"]
    E --> F["construct class"]
    F --> G["@Config / @Prompt early injections"]
    G --> H["@Inject / @Scope dependency injections"]
    H --> I["@Init lifecycle method"]
    I --> J["Factory.synapse()"]
```

Only the IOC container should construct application classes. Singleton classes are cached by decorator metadata; ordinary providers are created fresh when resolved.

## One User Turn

```mermaid
flowchart TD
    User["IPC packet<br/>action=user or answer"] --> Decode["FSocket -> IPCPacket.decode"]
    Decode --> Input["Synapse.emit(input, text)"]
    Input --> AgentNext["active Agent.next(text)"]
    AgentNext --> Ingest["Context.ingest()<br/>LLM extracts intent, goal, cwd, refs"]
    Ingest --> Route["Callosum.route(text)"]

    Route --> Choice{"route type"}
    Choice -- reply --> Reply["Brain.reply()<br/>stream Memory messages through Intelligence"]
    Reply --> ReplyOut["Synapse reply chunks<br/>then streamEnd"]
    ReplyOut --> Settle1["Context.settle()"]

    Choice -- research or task --> Research["Investigation.run()"]
    Research --> LlmTools["Intelligence.streamRequest()<br/>with tool definitions"]
    LlmTools --> HasAction{"tool calls?"}
    HasAction -- no --> FinalAnswer["final answer"]
    HasAction -- yes --> RunTool["ToolComponent.run()"]
    RunTool --> Pause{"ask / confirm?"}
    Pause -- yes --> UserPause["emit ask or confirm<br/>mark active turn paused"]
    Pause -- no --> LlmTools
    FinalAnswer --> Settle2["Context.settle(evidence)"]

    Choice -- soul --> Soul["render prompt package XML<br/>LLM plans writes"]
    Soul --> Apply["PromptService.applyWrites()"]
    Apply --> Settle3["Context.settle()"]

    Choice -- coordinate --> Coordinate["Synapse.coordinate()<br/>LLM plan with temporary personas"]
    Coordinate --> Workers["silent worker understand() calls"]
    Workers --> Review["silent reviewer understand() call"]
    Review --> Synthesis["synthesize outcomes + review"]
    Synthesis --> Settle4["Context.settle(evidence)"]
```

`Context` is the durable turn owner. `Memory` is not a transcript; it is a bounded private note cache seeded from a `Context.brief()`.

## IPC Contract

Every packet on the kernel socket is one 8-byte unsigned big-endian JSON body length followed by a UTF-8 JSON body:

```txt
+--------------------------+-------------------------------+
| 8-byte body length (BE)  | JSON body bytes (UTF-8)       |
+--------------------------+-------------------------------+
```

Inbound packets with `action: "user"` or `action: "answer"` become agent input. Other inbound actions are dispatched to `Controller`; the current controller action is `cwd`, which updates `ConfigService.path.cwd`.

Common outbound actions are `open`, `agent`, `streamEnd`, `data`, `ask`, `confirm`, `pause`, `resume`, and `error`.

## Model Boundary

`Intelligence` exposes one normalized stream contract:

- `text_delta` for visible output.
- `reasoning_delta` for provider reasoning that must be replayed when the provider expects it.
- `action_start`, `action_delta`, and `action_end` for streamed tool calls.
- `done` with `stop`, `length`, or `toolUse`.

Protocol selection comes from the active provider in `.config/config.jsonc`. Provider-level `protocols` override `model.protocols`; each protocol adapter owns only its wire body and stream parser.

## Tool Surface

The current model-visible tools are loaded from `prompts/tools/config.jsonc` and implemented under `src/plugins/tools`:

- `ask`: asks the user to choose from options; the tool adds an `other` option.
- `confirm`: asks for a yes/no-style confirmation with a recommended boolean.
- `filesystem`: `read`, `write`, `edit`, or file-only `delete`, resolved from explicit `cwd` or `ConfigService.path.cwd`.
- `shell`: runs one command with args and a bounded timeout.
- `execute`: runs serial or parallel `python` / `sh` script tasks with optional per-task cwd, env, and timeout.

`Investigation` owns the tool loop. Tool request/result replay stays inside provider messages and is not written into `Context.turns`.

## Prompt Runtime

`PromptService` loads either one markdown file or a prompt package directory with `config.jsonc`. Package configs define ordinary render sections, editable files, locked files, runtime-ignored files, and an XML document view used by the `soul` route.

Canonical runtime prompt sources are English `.md` files. `.zh.cn.md` files are human mirrors and must not become runtime source-of-truth.

## Source Layout

```txt
src/bootstrap.ts                       process entrypoint
src/app.module.ts                      root @Module
src/configuration.ts                   ConfigService and runtime config types
src/core/                              decorators, IOC, base classes, prompt, logger, tool contracts
src/neural/                            Synapse, IPC socket, packet codec, controller
src/agent/                             Agent, Brain, Callosum, Context, Memory, Investigation, Intelligence
src/plugins/                           plugin boundary and local tools
src/entities/                          entity/repository classes; MemoryRepo currently returns SQL statements
web/                                   local browser-to-IPC bridge and test page
prompts/                               prompt packages plus zh.cn mirrors
.config/                              runtime config and active agent prompt package
sql/                                   schema files
pakcages/                              bundled sqlite-vec helper/native assets; not in the current agent turn path
scripts/check.script.ts                docs mirror and prompt-term checks
```

## Current Edges

`MemoryRepo` and `sql/001-core-schema.sql` prepare a future persistence boundary, but the current `Agent`, `Context`, and `Memory` path is in memory. The config file also declares skills and MCP shapes, but this codebase does not yet include a runtime MCP client or skill loader wired into the turn loop.

Project rules live in `AGENTS.md`; this README is only the implementation overview.
