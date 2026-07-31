# Flyflor

Flyflor 是一个 Bun + TypeScript agent kernel。当前代码围绕 decorated classes、reflect-metadata IOC container、本地 length-prefixed IPC socket、prompt package、provider protocol adapter 和一组本地工具面运行。

## 快速开始

```bash
bun install
export DEEPSEEK_API_KEY=...
bun run dev
bun run client
```

`bun run dev` 启动 `src/bootstrap.ts` 并打开配置中的 IPC socket。`bun run client` 在 `http://127.0.0.1:17878` 启动本地浏览器桥，通过 WebSocket 把浏览器 JSON 消息转发到这个 socket（每个浏览器客户端一条 kernel 连接）。

改动健康门槛：

```bash
bun run check
bun test
bun run build:binary
```

`bun run check` 会跑 TypeScript 和仓库红线扫描。默认 model/provider 在 `.config/config.jsonc`；secret 只放环境变量。

## 运行时地图

### 种群层

```mermaid
flowchart TB
    Bridge["web/client.ts<br/>浏览器桥"] <--> Socket["FSocket（全局单例）<br/>共享感觉-运动传输面<br/>按 speakerId 寻址"]
    Socket -->|"perceive / answer / forget / route"| Manager["AgentManager（纯路由，无 LLM）<br/>speaker→agent 绑定表<br/>默认 main；action=route 换绑"]

    subgraph Pop["Population（配置驱动，容量有界）"]
        Manager --> Main["Agent 'main'"]
        Manager --> Other["Agent '&lt;id&gt;'"]
    end

    Main -. 结构相同 .-> Other
    Main -. 共享 .-> Infra["无状态共享设施<br/>Intelligence · ToolComponent · ConfigService"]
```

### 单个 Agent 内部

```mermaid
flowchart TB
    Bootstrap["src/bootstrap.ts<br/>先加载 reflect-metadata"] --> Factory["Factory.create(AppModule)"]
    Factory --> Container["Container<br/>构造、注入、运行 @Init"]
    Container --> AppModule["AppModule<br/>imports AgentManager + PluginModule"]
    AppModule --> PluginModule["PluginModule"]
    PluginModule --> Tools["ToolComponent<br/>ask, filesystem, shell, execute"]

    AppModule --> Manager["AgentManager<br/>按配置构建 Agent"]
    Manager --> Agent["Agent<br/>一个完整生命体"]

    Agent --> Thalamus["Thalamus<br/>注意门 + 唯一的嘴"]
    Thalamus --> Scheduler["Scheduler<br/>中央执行器:队列、公平、抢占"]
    Agent --> Cortex["Cortex<br/>信号中枢 + 单一 Brain"]
    Thalamus --> Cortex
    Cortex --> Brain["Brain<br/>单一心智：turn 编排"]
    Brain --> Workspace["Workspace<br/>四槽语义工作集"]
    Workspace --> SituationModel["SituationModel<br/>进程内情境缓冲"]
    Brain --> Scratchpad["Scratchpad<br/>私有临时笔记"]
    Brain --> Investigation["Investigation<br/>local action loop"]
    Brain --> Intelligence["Intelligence<br/>provider stream boundary"]
    Workspace --> Intelligence
    Investigation --> Tools
    Investigation --> Intelligence
    Intelligence --> Protocols["Protocol adapters<br/>OpenAI, Anthropic, Gemini, Bedrock,<br/>Cohere, HuggingFace, Ollama, vLLM, LM Studio"]
```

每个 `Agent` 都持有完整子树；`Intelligence` 与 `ToolComponent` 解析到全局共享单例。

## 启动生命周期

```mermaid
flowchart LR
    A["bootstrap.ts"] --> B["import reflect-metadata"]
    B --> C["Factory.create(AppModule)"]
    C --> D["Container.getAsync(AppModule)"]
    D --> E["构建 module imports"]
    E --> F["构造 class"]
    F --> G["@Config / @Prompt 早期注入"]
    G --> H["@Inject / @Scope 依赖注入"]
    H --> I["@Init lifecycle method"]
    I --> J["Factory.population()"]
```

应用类只应由 IOC container 构造。带 singleton metadata 的 class 会缓存；普通 provider 每次解析时 fresh 创建。`useContainer().create()` 是特许的裸构造旁路——不跑 imports、注入或 `@Init`——用于路径绑定对象，比如 prompt package 里按文件创建的 service。agent 私有对象（`Workspace`、`Thalamus`、`Scheduler`、`Cortex`、`Brain`）是非单例 provider：由 `Agent` 组装器以构造参数穿线，因此每个 agent 持有独立子树，而 `ConfigService`、`Intelligence`、`ToolComponent`、`FSocket` 保持全局单例。

## 一次用户回合

```mermaid
flowchart TD
    User["IPC packet<br/>action=user 或 answer"] --> Decode["FSocket -> IPCPacket.decode"]
    Decode --> Route["AgentManager<br/>speaker→agent 绑定（默认 main）"]
    Route --> Gate["Thalamus.perceive() -> Scheduler<br/>跨说话人轮转公平 + same/new + urgent"]
    Gate --> AgentNext["Brain.next(input)"]
    AgentNext --> Ingest["Workspace.ingest() 或 revise()<br/>语义 Turn 理解"]

    Ingest --> Choice{"Turn intent"}
    Choice -- reply --> Reply["Brain.reply()<br/>有界 Scratchpad notes 经过 Intelligence stream"]
    Reply --> ReplyOut["Cortex reply chunks<br/>然后 streamEnd"]
    ReplyOut --> Settle1["Workspace.settle()"]

    Choice -- research --> Research["Investigation.run()"]
    Research --> LlmTools["Intelligence.streamRequest()<br/>with tool definitions"]
    LlmTools --> HasAction{"tool calls?"}
    HasAction -- no --> FinalAnswer["final answer"]
    HasAction -- yes --> RunTool["ToolComponent.run()"]
    RunTool --> Pause{"ask / confirm?"}
    Pause -- yes --> UserPause["emit ask 或 confirm<br/>标记 active turn paused"]
    Pause -- no --> LlmTools
    FinalAnswer --> Settle2["Workspace.settle(evidence)"]

    Choice -- coordinate --> Coordinate["Cortex.coordinate()<br/>LLM 规划并行思维切片"]
    Coordinate --> Workers["并行静默思维线程 understand() 调用<br/>失败切片隔离"]
    Workers --> Review["静默自我审核 understand() 调用"]
    Review --> Synthesis["综合 outcomes + review"]
    Synthesis --> Settle4["Workspace.settle({assistant, evidence})"]
    Settle4 --> CoordOut["把合成答案流出<br/>然后 streamEnd"]
```

`Workspace` 是四槽语义工作集，不是 durable archive。容量不足时只淘汰最早的 completed Turn，不使用墙上时间 TTL。已结算的 Turn 会升格(“promote”)进 `SituationModel`——有界的**进程内情境缓冲**，上限 16 条记录（不是长期记忆，无召回 API，不落盘）——让理解与调度在同一进程寿命内看到四槽之外的前情；升格按 Turn 幂等，suspended Turn 不会被升格。`Scratchpad` 是从更密的 `Workspace.brief()` 初始化的有界私有临时笔记（16 条笔记，每条最多 1024 字符）：包含生命周期 `status`、抢占后的可挽救 `outcome`、最近四条情境投影与其他 turn 的 outcome（最多四条）——从不写入 transcript。活跃运行时没有长期记忆写入路径。

## IPC 协议

kernel socket 上每个 packet 都是 8-byte unsigned big-endian JSON body length，加 UTF-8 JSON body。body 超过 4 MiB 按畸形包拒绝。

```txt
+--------------------------+-------------------------------+
| 8-byte body length (BE)  | JSON body bytes (UTF-8)       |
+--------------------------+-------------------------------+
```

入站 `action: "user"` 会变成说话人所绑定 agent 的 brain input（默认绑定 `main` agent）；`action: "answer"` 用于完成绑定 agent 上挂起的 ask/confirm 交互；`action: "route"` 携带 `{agent: "<id>"}` 把连接换绑到另一个 agent，并收到 `{action: "route", data: {agent, ok}}` 回执。其他入站 action 会派发给 `Controller`；当前 controller action 是 `cwd`，用于更新 `ConfigService.path.cwd`。解码成功但校验失败的 packet 只记录日志并跳过，不中断其后粘连的帧；length 切分或 JSON 解码失败的帧会拒绝整批读取，并重置该连接的入站 buffer。

常见出站 action 是 `open`、`agent`、`interrupted`、`streamEnd`、`data`、`ask`、`confirm`、`pause`、`resume`、`route`、`error`。

## 模型边界

`Intelligence` 对外只暴露统一 stream contract：

- `text_delta`：可见输出。
- `reasoning_delta`：需要在 provider 后续调用中回放的 reasoning。
- `action_start`、`action_delta`、`action_end`：streaming tool call。
- `done`：结束原因是 `stop`、`length` 或 `toolUse`。

协议选择来自 `.config/config.jsonc` 里的 active provider。provider 级 `protocols` 覆盖 `model.protocols`；配置列表是一条有序回退链，只对特定 HTTP 状态码（400/404/405/415/422/501）尝试下一协议，并带 `/v1` URL 回退。每个 protocol adapter 只负责自己的 wire body 和 stream parser。streaming tool call——也就是 `Investigation` 的 tool loop——目前只有 OpenAI chat completions adapter 族实现（HuggingFace、LM Studio、vLLM adapter 直接复用它）；其余 adapter 仅支持文本并丢弃 action 消息，且只有 OpenAI chat completions 族会把累积的 reasoning 回放进 provider messages。

## 工具面

当前暴露给模型的工具由 `prompts/tools/config.jsonc` 加载，实现在 `src/plugins/tools`：

- `ask`：请用户从选项中选择；工具会自动补一个 `other` 选项。
- `filesystem`：`read`、`write`、`edit` 或 file-only `delete`，路径来自显式 `cwd` 或 `ConfigService.path.cwd`。
- `shell`：运行一个 command + args，timeout 有界（钳制在 1–120 秒，默认 30 秒）。
- `execute`：串行或并行运行 `python` / `sh` script tasks，可带 per-task cwd、env、timeout。

确认是一种交互种类，不是工具。每个工具在 `prompts/tools/config.jsonc` 里声明 `risk` 级别，代码层门禁（`filesystem` 的 write/edit/delete，以及所有 `shell`、`execute` 调用）会让 `Investigation` 在执行前发出 `confirm` 交互；`ask` 结果同样会把 active turn 挂起直到用户回答。标记 `cwd: "inject"` 的工具在参数缺省时会被注入 turn 的工作目录。`shell` 与 `execute` 在超时或取消时终止进程组，被取消的串行批次不会再启动剩余任务。

`Investigation` 拥有 tool loop。tool request/result replay 只留在 provider messages 里，不写入 `Workspace.turns`。

## Prompt Runtime

`PromptService` 可加载单个 markdown 文件，也可加载带 `config.jsonc` 的 prompt package 目录。package config 定义普通渲染 sections、editable files、locked files、runtime-ignored files，以及可选的 XML document view。persona package 默认是 `./prompts/agent`，活跃配置把它指向 `./.config/persona`；运行时只播种静态 persona section——缺省为 `SOUL.md` 与 `EXTENSION.md`，`AGENTS.md` 可经 `persona.promptSections` 启用，`USER.md` 始终被过滤。运行时 prompt 写入和旧 `soul` route 已禁用。

canonical runtime prompt source 是英文 `.md` 文件。`.zh.cn.md` 是 human mirror，不能成为运行时 source-of-truth。除 persona 包外，运行时 prompt contract 还有 `prompts/thalamus/SCHEDULE.md`、`prompts/workspace/INGEST.md` 与 `SETTLE.md`、`prompts/cortex` 的 plan/synthesis 包，以及 `prompts/tools`。

## 源码布局

```txt
src/bootstrap.ts                       process entrypoint
src/app.module.ts                      root @Module
src/configuration.ts                   ConfigService 和 runtime config types
src/core/                              decorators、IOC、base classes、prompt、logger、tool contracts
src/neural/                            neural 域根部：共享信号类型、LLM JSON 解析辅助
src/neural/cortex/                     Cortex 信号中枢：前台 turn、思维协同
src/neural/thalamus/                   Thalamus 注意门 + Scheduler 中央执行器
src/neural/sensorimotor/               IPC socket、packet codec、connection、controller
src/neural/brain/                      Brain、Scratchpad、Investigation、Intelligence
src/neural/workspace/                  Workspace 和 Turn 生命周期
src/neural/situation/                  有界的进程内 SituationModel
src/plugins/                           plugin boundary 和 local tools
src/population/                        AgentManager 路由 + Agent 生命体组装器
web/                                   本地 browser-to-IPC WebSocket bridge 和测试页
prompts/                               prompt packages 和 zh.cn mirrors
.config/                               runtime config 和活跃 persona prompt package
packages/                              bundled sqlite-vec helper/native assets；参与编译但不在当前 agent turn path
scripts/check.script.ts                仓库镜像、prompt-term 与代码风格 checks
```

## 当前边界

active tree 中不存在持续记忆 repository 和 schema。`packages/` 下的 bundled sqlite-vec native assets 仍未接入 `Brain`、`Workspace`、`SituationModel` 或 `Scratchpad`；`packages/index.ts` 是空 barrel，`sqlite-vec/index.ts` 与 `sqlite-vec/loader.ts` 是近乎重复的 helper。config file 也声明了 skills 和 MCP shapes，但当前代码还没有把 runtime MCP client 或 skill loader 接进 turn loop。其他已知边界：

- streaming tool call 只在 OpenAI chat completions adapter 族可用；其余六个 adapter 仅支持文本，且十个 adapter 里九个还没有直接测试。
- provider 的 `requestTimeoutSeconds` 与 `staleTimeoutSeconds` 已在 config 声明，但 transport 尚未执行。
- `filesystem` 工具解析路径时不限制在 working directory 内；绝对路径与 `..` 段可以越界。
- `src/plugins/tools/confirm.ts` 里有一个未注册的 `Confirm` 原子；运行时确认是由工具风险门禁驱动的交互种类，不是暴露给模型的工具。
- 浏览器桥没有自动重连：kernel socket 关闭会连带关闭浏览器 WebSocket。
- 所有 agent 共享全局 `model`/`providers` 配置；per-agent model 覆盖尚未接线。
- unix socket 是目前唯一渠道；population 路由对渠道无感知，但第二种传输还不存在。
- 不存在跨 agent 消息；本阶段 agent 间隔离是彻底的。

## 种群设计

状态：已落地的研发原型。所有 IPC 连接都面对一个由确定性 `AgentManager` 路由的
agent 种群；每个 agent 都是一个完整的无 session 生命体。连接只提供临时说话人身份，
默认绑定 `main` agent（可用显式 `route` action 换绑），不创建 session，
也不创建持久对话库。

### 种群不变量

1. 路由是确定性的：说话人默认绑定 `main` agent，除非显式 `route` action 换绑。
   manager 不咨询模型，也不解读内容。
2. 隔离是构造级的：agent 间不共享任何工作状态。`Thalamus`、`Scheduler`、`Workspace`、
   `SituationModel`、`Cortex`、`Brain` 实例都是 per-agent；只有无状态设施
   （`ConfigService`、`Intelligence`、`ToolComponent`、socket 监听器）被共享。
3. 种群有界且配置驱动：agent 来自 `config.population.agents`，超出 `capacity` 截断；
   本阶段运行时和模型都不能 spawn agent。
4. 每个生命体只有一个 context：一条连接同一时刻只寻址一个 agent，不存在跨 agent 消息。

### 生物学参考点

以下神经科学文献提供设计约束和类比，不表示 LLM runtime 等同于大脑，也不证明本原型
具有意识。

- Baddeley，《Working memory: theories, models, and controversies》（2012），
  [PMID 21961947](https://europepmc.org/article/MED/21961947)：工作记忆是有限、
  需要主动维持的工作空间，不是无限日志。
- Cowan，《The magical number 4 in short-term memory》（2001），
  [PMID 11515286](https://europepmc.org/article/MED/11515286)：启发原型采用四个
  语义 Turn 槽。四不是生物学常数。
- Lewandowsky 等，《No evidence for temporal decay in short-term memory》（2009），
  [PMID 19223224](https://europepmc.org/article/MED/19223224)：反对把墙上时间 TTL
  当作一般遗忘理论；Flyflor 改用容量与干扰边界。
- Stokes，《Activity-silent working memory》（2015），
  [PMID 26051384](https://europepmc.org/article/MED/26051384)：支持一个较弱类比——
  重新激活紧凑任务集，而不是回放 transcript。
- Halassa 与 Kastner，《Thalamic functions in distributed cognitive control》（2017），
  [PMID 29184210](https://europepmc.org/article/MED/29184210)：启发门控/控制类比；
  `Thalamus` 不是字面丘脑，也不是显著性神谕。
- Aston-Jones 与 Cohen，《An integrative theory of locus
  coeruleus-norepinephrine function》（2005），
  [PMID 16022602](https://europepmc.org/article/MED/16022602)：启发稀疏、阈值化的
  中断信号，而不是持续由模型打分的优先级。
- Mashour 等，《The global neuronal workspace》（2020），
  [PMID 32135090](https://europepmc.org/article/MED/32135090)：启发单一前台广播
  边界与一张嘴；这是架构类比，不表示软件里存在全局神经工作空间。
- Alberini 与 LeDoux，《Memory reconsolidation》（2013），
  [PMID 24028957](https://europepmc.org/article/MED/24028957)：启发更新挂起任务集的
  弱软件类比。Turn 修订不等于生物记忆再巩固。
- Klinzing、Niethard 与 Born，《Mechanisms of systems memory consolidation
  during sleep》（2019），
  [PMID 31451802](https://europepmc.org/article/MED/31451802)：在关闭长期记忆时，
  必须同时明确禁止 replay 与 consolidation 通路。
- Kassab 与 Alexandre，《Pattern separation in the hippocampus: distinct
  circuits under different conditions》（2018），
  [PMID 29637298](https://europepmc.org/article/MED/29637298)：弱类比启发来源分离；
  真正的隐私仍来自确定性的 speaker ownership、数据最小化与不持久化。
- Hutchins，《Cognition in the Wild》（1995，MIT Press）：分布式认知为种群层
  提供框架——认知是分布在生命体与环境之间的系统；manager 是环境，
  不是超级心智。

### 运行时不变量

以下不变量由每个 agent 在种群内独立持有。

1. 连接只是说话人身份（`conn_N`）。路由到同一 agent 的所有说话人进入该 agent 的
   `Thalamus` 与 `Workspace`；不存在 session 对象。
2. `Workspace` 最多保存四个语义 Turn 投影。Turn 包含 intent、目标、约束、引用、done/open
   标签、可选的 cwd 与 output 提示，以及紧凑 outcome；绝不保存 user/assistant transcript
   或工具回放缓冲。
3. Turn 状态是 `working`、`waiting`、`suspended`、`completed`。容量压力下只可淘汰
   最早的 completed Turn，不使用墙上时间过期。
4. 临时感觉队列独立有界（默认 32）。队列满时明确向最新刺激返回背压错误；若四个语义
   槽都受保护，被判为 `new` 的刺激同样明确拒绝。两种情况都不会静默丢弃或无限保留。
5. 同一说话人的追问若判定为 `same`，调用 `Workspace.revise()` 并保留 Turn id；独立刺激
   是 `new`，保持 FIFO。确定性代码拒绝跨说话人修订。
6. 外部刺激串行执行。单个 Turn 可以使用并行思维切片与自我审核通道，但它不会形成
   第二条外部注意流。
7. 只有明确的布尔 `urgent` 判决可以抢占前台 Turn。runtime 取消其 provider 与可取消
   工具工作，把 Turn 压缩为 suspended，依次发送 `interrupted`、`streamEnd`，再释放嘴。
   已经输出的文字无法收回。
8. `AbortSignal` 贯穿 provider request 与 investigation 工具边界。`shell`、`execute`
   会终止活动进程组，取消后不再启动后续串行任务。同步 filesystem 调用只可在操作前后
   检查取消；已完成的写入或其他副作用不会回滚。
9. answer、interaction、stream 与断连清理都校验所属 `speakerId`。遗忘说话人的迟到输出，
   以及同一 Turn 上旧 stream generation 的迟到分片，会被丢弃。
10. active prompt 只读取静态 persona section：缺省为 `SOUL.md` 与 `EXTENSION.md`，
    `AGENTS.md` 可经 `persona.promptSections` 启用；`USER.md` 始终被过滤。运行时 prompt
    写入、持久 repository、episodic archive 和后台 replay 都不在 active path。
11. 诊断只包含 speaker/stimulus id、relation、text length 等路由元数据，不把刺激或回答
    原文持久化成影子 transcript。

### 对象边界

| 层 | 职责 |
| --- | --- |
| `FSocket` / `Connection` | 解码带长度帧的 IPC、分配 speaker id、把刺激转发给 population 路由；单个校验失败的 packet 只跳过不中断后续帧，帧本身无法解码时重置该连接的入站 buffer。 |
| `AgentManager` | 按确定性绑定把说话人路由给 agent（默认 `main`，显式 `route` 换绑），持有有界的 agent 注册表，绝不解读内容。 |
| `Agent` | 组装一个完整生命体子树（Thalamus、Scheduler、Workspace、SituationModel、Cortex、Brain），并把路由来的刺激转发进去。 |
| `Thalamus` | 感知刺激、持有说话人墓碑与单嘴锁,并为调度器接线皮层边界。 |
| `Scheduler` | 持有刺激准入、跨说话人轮转公平(说话人内部 FIFO)、LLM 判决咨询与校验后的紧急抢占。 |
| `Workspace` | 持有四槽语义工作集和 Turn 生命周期,并把已结算 Turn 升格进 situation 缓冲。 |
| `SituationModel` | 持有有界的进程内情境缓冲(16 条升格后的 turn outcome);仅限进程内,绝不是长期记忆或召回。 |
| `Cortex` | 执行一个前台刺激、取消它、把输出寻址给所属说话人，并协调并行思维线程。 |
| `Brain` | 摄取或修订 Turn，执行 reply、research 或 coordinate 意图。 |
| `Scratchpad` | 保存由更密 brief 初始化的有界私有笔记(status、可挽救 outcome、情境、同伴 turn)；不是持久化层。 |
| `ToolComponent` | 在确认与取消边界后执行本地能力。 |

调度模型只能提出 `same|new`、`targetTurnId` 和布尔 `urgent`。身份、容量、有效抢占目标、
FIFO、公平性和 stream 顺序由确定性代码负责。调度结果格式错误或超时时，按轮转选中的
待处理刺激回退为 `new`，绝不隐式合并。`prompts/thalamus/SCHEDULE.md` 是 canonical runtime
contract；`SCHEDULE.zh.cn.md` 只是人类镜像。

### 明确不做的事

- 本阶段不保存持久用户画像、不写 native-vector、不建 episodic archive、不做自动
  跨进程 recall，也不允许隐藏的 provider/tool transcript cache。
- 不宣称四槽、丘脑门控类比、蓝斑语言或前台广播边界可以证明意识。
- 在没有测量依据和更强所有权模型前，不在单个 agent 内并行处理相互独立的外部刺激。
- 本阶段不做跨 agent 消息、per-agent model 覆盖或 manager 智能化；衰减与召回机制
  按设计推迟。
- 不承诺撤销取消前已经完成的外部副作用。

### 验证

运行 `bun run check` 与 `bun test`。测试覆盖四槽容量与无时间衰退、有界感觉背压、同 Turn
修订、FIFO/urgent 调度、说话人隔离、断连清理、可取消 provider 与进程工作、旧 stream
抑制、`interrupted` → `streamEnd` 顺序、格式错误/coalesced IPC frame、种群路由
（默认 `main` 绑定、`route` 换绑、容量截断）、agent 间工作状态隔离，以及 browser
client 清理过期 interaction。

项目规则在 `AGENTS.md`；本 README 是完整的实现与研发设计总览。
