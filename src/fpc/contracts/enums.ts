export const Channel = {
    Api: "api",
    BlueBubbles: "bluebubbles",
    Discord: "discord",
    DingTalk: "dingtalk",
    Email: "email",
    Feishu: "feishu",
    HomeAssistant: "homeassistant",
    IMessage: "imessage",
    Line: "line",
    Mattermost: "mattermost",
    Matrix: "matrix",
    QQ: "qq",
    Signal: "signal",
    Slack: "slack",
    Sms: "sms",
    Stdio: "stdio",
    Telegram: "telegram",
    WeCom: "wecom",
    WeChat: "wechat",
    Webhook: "webhook",
    WhatsApp: "whatsapp",
    WeixinIlink: "weixin-ilink",
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

export const ModelRole = {
    Assistant: "assistant",
    System: "system",
    Tool: "tool",
    User: "user",
} as const;

export type ModelRole = (typeof ModelRole)[keyof typeof ModelRole];

export const ModelProviderKind = {
    AnthropicCompatible: "anthropic-compatible",
    Mock: "mock",
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
    FastAi: "fastai",
    Gemini: "gemini",
    Groq: "groq",
    Kimi: "kimi",
    Local: "local",
    Minimax: "minimax",
    MinimaxCn: "minimax-cn",
    Mistral: "mistral",
    Mock: "mock",
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

export const RuntimeMode = {
    Chat: "chat",
    Gateway: "gateway",
} as const;

export type RuntimeMode = (typeof RuntimeMode)[keyof typeof RuntimeMode];

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

export const BlackboardWorkerRole = {
    Implementer: "flyflor-implementer",
    Planner: "flyflor-planner",
    Reflector: "flyflor-reflector",
    Researcher: "flyflor-researcher",
    Reviewer: "flyflor-reviewer",
    Verifier: "flyflor-verifier",
} as const;

export type BlackboardWorkerRole = string;

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
    Session: "session",
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

export const FpcLayer = {
    Capability: "capability",
    Composition: "composition",
    Control: "control",
    Extension: "extension",
    Process: "process",
    Protocol: "protocol",
    Runtime: "runtime",
} as const;

export type FpcLayer = (typeof FpcLayer)[keyof typeof FpcLayer];

export const MemoryLayer = {
    Markdown: "markdown",
    Qdrant: "qdrant",
    SQLite: "sqlite",
} as const;

export type MemoryLayer = (typeof MemoryLayer)[keyof typeof MemoryLayer];

export const MemoryKind = {
    Candidate: "candidate",
    ConversationTurn: "conversation-turn",
    Fact: "fact",
    History: "history",
    Profile: "profile",
    Rule: "rule",
    SessionMessage: "session-message",
    Summary: "summary",
} as const;

export type MemoryKind = (typeof MemoryKind)[keyof typeof MemoryKind];

export const MemoryCandidateStatus = {
    Candidate: "candidate",
    Promoted: "promoted",
    Rejected: "rejected",
} as const;

export type MemoryCandidateStatus = (typeof MemoryCandidateStatus)[keyof typeof MemoryCandidateStatus];

export const MemorySourceKind = {
    ExplicitUserIntent: "explicit-user-intent",
    SessionConsolidation: "session-consolidation",
    Reflection: "reflection",
    SignalAnalysis: "signal-analysis",
} as const;

export type MemorySourceKind = (typeof MemorySourceKind)[keyof typeof MemorySourceKind];

export const MarkdownMemoryFile = {
    Memory: "MEMORY.md",
    Self: "SELF.md",
    Soul: "SOUL.md",
    User: "USER.md",
} as const;

export type MarkdownMemoryFile = (typeof MarkdownMemoryFile)[keyof typeof MarkdownMemoryFile];
