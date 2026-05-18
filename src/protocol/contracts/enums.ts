export const Channel = {
    Api: "api",
    ApiServer: "api_server",
    BlueBubbles: "bluebubbles",
    Discord: "discord",
    DingTalk: "dingtalk",
    Email: "email",
    Feishu: "feishu",
    GoogleChat: "google_chat",
    HomeAssistant: "homeassistant",
    IMessage: "imessage",
    Irc: "irc",
    Line: "line",
    Mattermost: "mattermost",
    Matrix: "matrix",
    MsGraphWebhook: "msgraph_webhook",
    QQ: "qq",
    QQBot: "qqbot",
    Signal: "signal",
    Slack: "slack",
    Sms: "sms",
    Stdio: "stdio",
    Teams: "teams",
    Telegram: "telegram",
    WeCom: "wecom",
    WeComCallback: "wecom_callback",
    WeChat: "wechat",
    Webhook: "webhook",
    WhatsApp: "whatsapp",
    Ws: "ws",
    WeixinIlink: "weixin-ilink",
    Yuanbao: "yuanbao",
    Zalo: "zalo",
} as const;

export type ChannelName = (typeof Channel)[keyof typeof Channel];

export const ChatType = {
    Direct: "direct",
    Group: "group",
    Thread: "thread",
    Unknown: "unknown",
} as const;

export type ChatType = (typeof ChatType)[keyof typeof ChatType];

export const GatewayMessageKind = {
    Audio: "audio",
    Command: "command",
    Comment: "comment",
    Document: "document",
    Location: "location",
    Photo: "photo",
    Sticker: "sticker",
    Text: "text",
    Unknown: "unknown",
    Video: "video",
    Voice: "voice",
} as const;

export type GatewayMessageKind = (typeof GatewayMessageKind)[keyof typeof GatewayMessageKind];

export const GatewayMessageAction = {
    Create: "create",
    Delete: "delete",
    Edit: "edit",
    Reaction: "reaction",
    Unknown: "unknown",
} as const;

export type GatewayMessageAction = (typeof GatewayMessageAction)[keyof typeof GatewayMessageAction];

export const GatewayProcessingOutcome = {
    Cancelled: "cancelled",
    Failure: "failure",
    Success: "success",
} as const;

export type GatewayProcessingOutcome = (typeof GatewayProcessingOutcome)[keyof typeof GatewayProcessingOutcome];

export const GatewayOutboundOperation = {
    CardCreate: "card.create",
    CardUpdate: "card.update",
    MessageDelete: "message.delete",
    MessageEdit: "message.edit",
    MessageSend: "message.send",
    ReactionAdd: "reaction.add",
    ReactionRemove: "reaction.remove",
    ThreadCreate: "thread.create",
    TypingStart: "typing.start",
    TypingStop: "typing.stop",
} as const;

export type GatewayOutboundOperation = (typeof GatewayOutboundOperation)[keyof typeof GatewayOutboundOperation];

export const GatewayReplyToMode = {
    All: "all",
    First: "first",
    Off: "off",
} as const;

export type GatewayReplyToMode = (typeof GatewayReplyToMode)[keyof typeof GatewayReplyToMode];

export const ModelRole = {
    Assistant: "assistant",
    System: "system",
    Tool: "tool",
    User: "user",
} as const;

export type ModelRole = (typeof ModelRole)[keyof typeof ModelRole];

export const ModelProviderKind = {
    AnthropicCompatible: "anthropic-compatible",
    OpenAICompatible: "openai-compatible",
} as const;

export type ModelProviderKind = (typeof ModelProviderKind)[keyof typeof ModelProviderKind];

export const ModelApiMode = {
    ChatCompletions: "chat-completions",
    Responses: "responses",
} as const;

export type ModelApiMode = (typeof ModelApiMode)[keyof typeof ModelApiMode];

export const ModelProviderId = {
    AiGateway: "ai-gateway",
    Anthropic: "anthropic",
    AzureOpenAI: "azure-openai",
    Bedrock: "bedrock",
    Claude: "claude",
    Custom: "custom",
    DeepSeek: "deepseek",
    Gemini: "gemini",
    Groq: "groq",
    Kimi: "kimi",
    Local: "local",
    Minimax: "minimax",
    MinimaxCn: "minimax-cn",
    Mistral: "mistral",
    Ollama: "ollama",
    OpenAI: "openai",
    OpenRouter: "openrouter",
    Qwen: "qwen",
    QwenIntl: "qwen-intl",
    Xai: "xai",
    Zai: "zai",
} as const;

export type ModelProviderId = (typeof ModelProviderId)[keyof typeof ModelProviderId];

export const SandboxMode = {
    Off: "off",
    Yolo: "yolo",
} as const;

export type SandboxMode = (typeof SandboxMode)[keyof typeof SandboxMode];

export const ToolApprovalMode = {
    Allow: "allow",
    Ask: "ask",
    Deny: "deny",
} as const;

export type ToolApprovalMode = (typeof ToolApprovalMode)[keyof typeof ToolApprovalMode];

export const CapabilityExecutionKind = {
    McpTool: "mcp-tool",
    Plugin: "plugin",
    ShellHook: "shell-hook",
} as const;

export type CapabilityExecutionKind = (typeof CapabilityExecutionKind)[keyof typeof CapabilityExecutionKind];

export const CttlCapabilitySource = {
    Channel: "channel",
    Core: "core",
    Mcp: "mcp",
    Plugin: "plugin",
    Skill: "skill",
    Subagent: "subagent",
    User: "user",
} as const;

export type CttlCapabilitySource = (typeof CttlCapabilitySource)[keyof typeof CttlCapabilitySource];

export const CttlToolScope = {
    Background: "background",
    Channel: "channel",
    Chat: "chat",
    Core: "core",
    Debug: "debug",
    Local: "local",
    Memory: "memory",
    Project: "project",
    Subagent: "subagent",
} as const;

export type CttlToolScope = (typeof CttlToolScope)[keyof typeof CttlToolScope];

export const CttlPermission = {
    Computer: "computer",
    Dangerous: "dangerous",
    Execute: "execute",
    Message: "message",
    Network: "network",
    None: "none",
    Read: "read",
    Write: "write",
} as const;

export type CttlPermission = (typeof CttlPermission)[keyof typeof CttlPermission];

export const CttlToolCategory = {
    Coding: "coding",
    Computer: "computer",
    Integration: "integration",
    Media: "media",
    Memory: "memory",
    Message: "message",
    Network: "network",
    System: "system",
} as const;

export type CttlToolCategory = (typeof CttlToolCategory)[keyof typeof CttlToolCategory];

export const CttlHiddenReason = {
    Availability: "availability",
    ChannelCap: "channel-cap",
    Duplicate: "duplicate",
    InvalidDescriptor: "invalid-descriptor",
    PermissionCap: "permission-cap",
    ScopeMismatch: "scope-mismatch",
    SourceDisabled: "source-disabled",
    TrustDenied: "trust-denied",
} as const;

export type CttlHiddenReason = (typeof CttlHiddenReason)[keyof typeof CttlHiddenReason];

export const CttlLoopGuardReason = {
    FailedCallRepeat: "failed-call-repeat",
    MaxCallsExceeded: "max-calls-exceeded",
    RepeatedCallNoProgress: "repeated-call-no-progress",
    UnknownToolRepeat: "unknown-tool-repeat",
} as const;

export type CttlLoopGuardReason = (typeof CttlLoopGuardReason)[keyof typeof CttlLoopGuardReason];

export const RuntimeMode = {
    Chat: "chat",
    Cli: "cli",
    /**
     * 生命体常驻态：无 user 输入超过 memory.dormant.idleMinutes 后进入。
     * 行为契约：gateway 监听不停（任意入站立即切回 Chat），后台 worker 主导节拍。
     * 详见 docs/boundaries.md R1-R4；历史设计归档在 docs/old-docs/life.form.md。
     */
    Dormant: "dormant",
    Gateway: "gateway",
    Tui: "tui",
} as const;

export type RuntimeMode = (typeof RuntimeMode)[keyof typeof RuntimeMode];

export const RuntimeEventClass = {
    Ask: "ask",
    Control: "control",
    Effect: "effect",
    Error: "error",
    Lifecycle: "lifecycle",
    Performance: "performance",
    Question: "question",
    Read: "read",
    Write: "write",
} as const;

export type RuntimeEventClass = (typeof RuntimeEventClass)[keyof typeof RuntimeEventClass];

export const ChannelTransport = {
    Http: "http",
    Polling: "polling",
    Stdio: "stdio",
    Websocket: "websocket",
    Worker: "worker",
} as const;

export type ChannelTransport = (typeof ChannelTransport)[keyof typeof ChannelTransport];

export const GatewayControlProtocol = {
    EventV1: "flyflor.event.v1",
    WsV1: "flyflor.ws.v1",
} as const;

export type GatewayControlProtocol = (typeof GatewayControlProtocol)[keyof typeof GatewayControlProtocol];

export const GatewayControlMessageType = {
    Ack: "ack",
    ClientHello: "client.hello",
    Error: "error",
    EventPublish: "event.publish",
    EventSubscribe: "event.subscribe",
    EventUnsubscribe: "event.unsubscribe",
    GatewayMessageSend: "gateway.message.send",
    GatewayStatusGet: "gateway.status.get",
    GatewayStatusSnapshot: "gateway.status.snapshot",
    Ping: "ping",
    Pong: "pong",
    ServerHello: "server.hello",
    TurnDelta: "turn.delta",
    TurnError: "turn.error",
    TurnFinal: "turn.final",
} as const;

export type GatewayControlMessageType =
    (typeof GatewayControlMessageType)[keyof typeof GatewayControlMessageType];

export const ChannelLinkState = {
    Connected: "connected",
    Degraded: "degraded",
    Disabled: "disabled",
    NeedsBinding: "needs-binding",
    NeedsSetup: "needs-setup",
    Polling: "polling",
    Processing: "processing",
    Replying: "replying",
    Waiting: "waiting",
    Unknown: "unknown",
} as const;

export type ChannelLinkState = (typeof ChannelLinkState)[keyof typeof ChannelLinkState];

export const BlackboardMode = {
    Blackboard: "blackboard",
    Direct: "direct",
    DirectWithWatch: "direct-with-watch",
} as const;

export type BlackboardMode = (typeof BlackboardMode)[keyof typeof BlackboardMode];

export const BlackboardTurnStatus = {
    Converged: "converged",
    Failed: "failed",
    NeedsUser: "needs-user",
    Running: "running",
} as const;

export type BlackboardTurnStatus = (typeof BlackboardTurnStatus)[keyof typeof BlackboardTurnStatus];

export const BlackboardWorkerRole = {} as const;

export type BlackboardWorkerRole = string;

export const BlackboardWorkerProtocol = {
    V1: "flyflor.blackboard.worker.v1",
} as const;

export type BlackboardWorkerProtocol = (typeof BlackboardWorkerProtocol)[keyof typeof BlackboardWorkerProtocol];

export const BlackboardWorkerOutcome = {
    Blocked: "blocked",
    Continue: "continue",
    Final: "final",
} as const;

export type BlackboardWorkerOutcome = (typeof BlackboardWorkerOutcome)[keyof typeof BlackboardWorkerOutcome];

export const BlackboardConvergenceReason = {
    AwaitingWorkerConsensus: "awaiting-worker-consensus",
    AwaitingWorkerFinalOutput: "awaiting-worker-final-output",
    HardRoundBudgetExhausted: "hard-round-budget-exhausted",
    PeerQaOpenIssues: "peer-qa-open-issues",
    WaitingForWorkers: "waiting-for-workers",
    WorkersReachedConsensus: "workers-reached-consensus",
} as const;

export type BlackboardConvergenceReason =
    (typeof BlackboardConvergenceReason)[keyof typeof BlackboardConvergenceReason];

export const BlackboardDecisionKind = {
    Confirm: "confirm",
    Freeform: "freeform",
    MultiChoice: "multi-choice",
    SingleChoice: "single-choice",
} as const;

export type BlackboardDecisionKind = (typeof BlackboardDecisionKind)[keyof typeof BlackboardDecisionKind];

export const WorkerRuntimeKind = {
    AgentCli: "agent-cli",
    InProcess: "in-process",
    JsonProcess: "json-process",
    PersistentJsonProcess: "persistent-json-process",
    Process: "process",
    Thread: "thread",
    Tui: "tui",
} as const;

export type WorkerRuntimeKind = (typeof WorkerRuntimeKind)[keyof typeof WorkerRuntimeKind];

export const WorkerInteractionKind = {
    Interactive: "interactive",
    OneShot: "one-shot",
    Persistent: "persistent",
} as const;

export type WorkerInteractionKind = (typeof WorkerInteractionKind)[keyof typeof WorkerInteractionKind];

export const WorkerTaskStatus = {
    Completed: "completed",
    Failed: "failed",
    Queued: "queued",
    Running: "running",
    Timeout: "timeout",
} as const;

export type WorkerTaskStatus = (typeof WorkerTaskStatus)[keyof typeof WorkerTaskStatus];

export const ComponentKind = {
    Blackboard: "blackboard",
    Channel: "channel",
    Command: "command",
    Component: "component",
    Context: "context",
    Crystal: "crystal",
    FlyFlor: "flyflor",
    Gateway: "gateway",
    Llm: "llm",
    Memory: "memory",
    Mcp: "mcp",
    McpService: "mcp-service",
    Plugin: "plugin",
    Provider: "provider",
    Runtime: "runtime",
    Sandbox: "sandbox",
    Skill: "skill",
    Tool: "tool",
    Worker: "worker",
} as const;

export type ComponentKind = (typeof ComponentKind)[keyof typeof ComponentKind];

export const ProviderScope = {
    Factory: "factory",
    Singleton: "singleton",
} as const;

export type ProviderScope = (typeof ProviderScope)[keyof typeof ProviderScope];

export const ArchitectureLayer = {
    Capability: "capability",
    Composition: "composition",
    Control: "control",
    Extension: "extension",
    Process: "process",
    Protocol: "protocol",
    Runtime: "runtime",
} as const;

export type ArchitectureLayer = (typeof ArchitectureLayer)[keyof typeof ArchitectureLayer];

export const FpcLayer = ArchitectureLayer;
export type FpcLayer = ArchitectureLayer;

export const MemoryLayer = {
    Brain: "brain",
    Crystal: "crystal",
    Markdown: "markdown",
    Project: "project",
    SQLite: "sqlite",
} as const;

export type MemoryLayer = (typeof MemoryLayer)[keyof typeof MemoryLayer];

export const MemoryWorkingBackend = {
    Local: "local",
} as const;

export type MemoryWorkingBackend = (typeof MemoryWorkingBackend)[keyof typeof MemoryWorkingBackend];

export const CrystalMemoryBackend = {
    Local: "local",
} as const;

export type CrystalMemoryBackend = (typeof CrystalMemoryBackend)[keyof typeof CrystalMemoryBackend];

export const WorkingMemoryWalOperation = {
    DropEpisode: "drop-episode",
    ReinforceEpisode: "reinforce-episode",
    RewriteEpisode: "rewrite-episode",
    TouchConcepts: "touch-concepts",
    WriteEpisode: "write-episode",
} as const;

export type WorkingMemoryWalOperation = (typeof WorkingMemoryWalOperation)[keyof typeof WorkingMemoryWalOperation];

export const MemoryKind = {
    Candidate: "candidate",
    ConversationTurn: "conversation-turn",
    Fact: "fact",
    Gem: "gem",
    History: "history",
    Profile: "profile",
    Rule: "rule",
    // Skill is reserved for external SKILL.md packages and legacy persisted rows; crystal recall now emits Gem.
    Skill: "skill",
    Summary: "summary",
} as const;

export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export const MemoryActionTarget = {
    Memory: "memory",
    Self: "self",
    Soul: "soul",
    User: "user",
} as const;

export type MemoryActionTarget = (typeof MemoryActionTarget)[keyof typeof MemoryActionTarget];

export const MemoryCandidateStatus = {
    Candidate: "candidate",
    Promoted: "promoted",
    Rejected: "rejected",
} as const;

export type MemoryCandidateStatus = (typeof MemoryCandidateStatus)[keyof typeof MemoryCandidateStatus];

export const MemorySourceKind = {
    ExplicitUserIntent: "explicit-user-intent",
    UserTurn: "user-turn",
    Reflection: "reflection",
    SignalAnalysis: "signal-analysis",
    BlackboardConverged: "blackboard-converged",
    McpAugmented: "mcp-augmented",
    UserFeedback: "user-feedback",
} as const;

export type MemorySourceKind = (typeof MemorySourceKind)[keyof typeof MemorySourceKind];

export const MarkdownMemoryFile = {
    Memory: "MEMORY.md",
    Self: "SELF.md",
    Soul: "SOUL.md",
    User: "USER.md",
} as const;

export type MarkdownMemoryFile = (typeof MarkdownMemoryFile)[keyof typeof MarkdownMemoryFile];
