export type LocaleCode = "zh" | "en";

export type NavItem = {
    label: string;
    href: string;
};

export type FeatureItem = {
    title: string;
    body: string;
};

export type DocSection = FeatureItem & {
    bullets: string[];
    code?: string;
};

export type CodeBlock = {
    title: string;
    code: string;
};

export type SiteContent = {
    locale: LocaleCode;
    languageLabel: string;
    alternateLabel: string;
    repoUrl: string;
    nav: NavItem[];
    auth: {
        login: string;
        register: string;
        logout: string;
        github: string;
        email: string;
        password: string;
        name: string;
        noAccount: string;
        hasAccount: string;
        accountTitle: string;
        authCopy: string;
    };
    theme: {
        label: string;
        light: string;
        dark: string;
        system: string;
    };
    hero: {
        eyebrow: string;
        title: string;
        subtitle: string;
        primaryAction: string;
        secondaryAction: string;
        sourceAction: string;
    };
    install: {
        title: string;
        body: string;
        blocks: CodeBlock[];
    };
    agent: {
        title: string;
        body: string;
        items: FeatureItem[];
    };
    about: {
        title: string;
        body: string;
        principles: FeatureItem[];
    };
    docs: {
        title: string;
        body: string;
        sections: DocSection[];
    };
    market: {
        title: string;
        body: string;
        skill: string;
        mcp: string;
        install: string;
        source: string;
        downloads: string;
        stars: string;
    };
    bbs: {
        title: string;
        body: string;
        admin: string;
        announcements: string;
        leaderboard: string;
        newTopic: string;
        titlePlaceholder: string;
        bodyPlaceholder: string;
        submit: string;
        loginPrompt: string;
        replies: string;
        views: string;
    };
    footer: {
        tagline: string;
        repo: string;
        docs: string;
    };
};

export const defaultLocale: LocaleCode = "zh";
export const supportedLocales: LocaleCode[] = ["zh", "en"];
export const githubUrl = "https://github.com/flyflor/flyflor";

const installBlocksZh: CodeBlock[] = [
    {
        title: "一键安装",
        code: "curl -fsSL https://flyflor.dev/install.sh | sh",
    },
    {
        title: "从源码运行",
        code: "git clone https://github.com/flyflor/flyflor.git\ncd flyflor\nbun install\nbun run chat",
    },
    {
        title: "Docker dev",
        code: "bun run build:binary:linux\ndocker compose up -d",
    },
];

const installBlocksEn: CodeBlock[] = [
    {
        title: "One-line install",
        code: "curl -fsSL https://flyflor.dev/install.sh | sh",
    },
    {
        title: "Run from source",
        code: "git clone https://github.com/flyflor/flyflor.git\ncd flyflor\nbun install\nbun run chat",
    },
    {
        title: "Docker dev",
        code: "bun run build:binary:linux\ndocker compose up -d",
    },
];

export const siteContent: Record<LocaleCode, SiteContent> = {
    zh: {
        locale: "zh",
        languageLabel: "中文",
        alternateLabel: "English",
        repoUrl: githubUrl,
        nav: [
            {
                href: "/zh",
                label: "首页",
            },
            {
                href: "/zh/about",
                label: "介绍",
            },
            {
                href: "/zh/docs",
                label: "文档",
            },
            {
                href: "/zh/market",
                label: "市场",
            },
            {
                href: "/zh/bbs",
                label: "社区",
            },
        ],
        auth: {
            accountTitle: "开发者账号",
            authCopy: "登录后可以发帖、收藏市场条目，并继续接入 GitHub 开发者身份。",
            email: "邮箱",
            github: "GitHub 一键登录",
            hasAccount: "已有账号？",
            login: "登录",
            logout: "退出",
            name: "昵称",
            noAccount: "还没有账号？",
            password: "密码",
            register: "注册",
        },
        theme: {
            dark: "深色",
            label: "主题",
            light: "浅色",
            system: "跟随系统",
        },
        hero: {
            eyebrow: "Agent OS for Real Work",
            primaryAction: "一键安装",
            secondaryAction: "阅读文档",
            sourceAction: "GitHub 源码",
            subtitle:
                "Flyflor 是一个用 Bun + TypeScript 构建的智能体运行时：把渠道、记忆、黑板、沙箱、MCP、Skill 和多模型 provider 组织成可观察、可恢复、可审计的 Agent OS。",
            title: "Flyflor",
        },
        install: {
            blocks: installBlocksZh,
            body: "从一条命令开始，也可以直接从 GitHub 源码启动。配置固定走 JSONC，不把密钥和业务配置散落进环境变量。",
            title: "一键安装",
        },
        agent: {
            body: "Flyflor 的目标不是做一个聊天壳，而是把 runtime、gateway、blackboard、sandbox、memory 和 MCP 拆成清晰边界。",
            items: [
                {
                    body: "CLI、TUI、Webhook、Telegram、Discord、Slack、飞书、企业微信等渠道统一归一为 GatewayMessage。",
                    title: "多渠道 Gateway",
                },
                {
                    body: "复杂任务进入黑板，由 worker 在明确边界内讨论、收敛，再交回 runtime 执行。",
                    title: "黑板协作",
                },
                {
                    body: "Shell、MCP、插件和工具调用共享 SandboxPolicy，副作用可审批、可审计。",
                    title: "沙箱审批",
                },
                {
                    body: "brain.db 记录 append-only 生命事件，Crystal 将验证过的经验升格为 Gem。",
                    title: "长期记忆",
                },
            ],
            title: "Agent 基础能力",
        },
        about: {
            body: "项目哲学是约定大于配置、协议集中治理、语义判断交给模型结构化输出，运行时只负责可靠装配和副作用边界。",
            principles: [
                {
                    body: "app.ts 保持薄，依赖注入只在 composition root 显式装配，不做反射扫描。",
                    title: "薄入口",
                },
                {
                    body: "结构化块、枚举和事件集中登记，业务模块只校验 payload，不自造协议边界。",
                    title: "协议优先",
                },
                {
                    body: "业务语义不靠关键词和 includes，必须来自模型同轮结构化字段或专用 JSON 输出。",
                    title: "零字符匹配",
                },
            ],
            title: "为什么是 Flyflor",
        },
        docs: {
            body: "这里不是宣传页摘要，而是第一版可执行文档：从安装、配置、运行，到 Skill/MCP 生态、OpenClaw/Hermes 接入和沙箱边界。",
            sections: [
                {
                    body: "安装后先生成本地配置，再用 doctor/status 验证 provider、模板、memory 和 gateway 状态。",
                    bullets: [
                        "配置固定读取 ~/.flyflor/config.jsonc，Docker dev 对应 ./docker/config/config.jsonc。",
                        "不要把 provider、模型、渠道凭据和沙箱策略写进业务环境变量。",
                        "首次运行建议先执行 doctor，再进入 chat 或 TUI。",
                    ],
                    code: "curl -fsSL https://flyflor.dev/install.sh | sh\nflyflor doctor\nflyflor status\nflyflor chat",
                    title: "快速开始",
                },
                {
                    body: "Flyflor 使用内置默认 profile + 用户覆盖。新增厂商时先给空配置和默认模型列表，运行时只消费归一化后的 provider profile。",
                    bullets: [
                        "provider、model、channel registry、gateway 行为都走 JSONC 或 secrets provider。",
                        "业务模块不直接读取密钥，也不把密钥编译进二进制。",
                        "默认值在代码里有清晰约定，配置只覆盖差异。",
                    ],
                    code: "{\n    \"providers\": {\n        \"default\": \"local\",\n        \"profiles\": {\n            \"local\": {\n                \"models\": [\"llama3.2\"]\n            }\n        }\n    }\n}",
                    title: "配置模型",
                },
                {
                    body: "入口只启动 FlyFlor 主类，composition root 显式装配 provider/token，运行时再把任务拆给 gateway、blackboard、sandbox、memory 和 worker。",
                    bullets: [
                        "Runtime 负责 turn 生命周期和工具编排，不承担长期记忆策略。",
                        "Blackboard 只处理复杂协作收敛，最终决策交回 runtime。",
                        "Crystal 固化验证过的经验，Neural 维护工作记忆、长期图和慢通道。",
                    ],
                    title: "架构边界",
                },
                {
                    body: "Shell、文件写入、插件、MCP 和网络工具都必须经过同一套 sandbox capability，不允许绕过审批链路。",
                    bullets: [
                        "副作用工具要声明 capability、生命周期和可审计事件。",
                        "高风险动作进入审批或拒绝路径，不由业务模块临时判断。",
                        "公共事件和协议必须 JSON 可序列化，便于跨渠道恢复。",
                    ],
                    title: "工具与沙箱",
                },
                {
                    body: "Skill 是可安装、可复用的工作流能力；MCP 是外部工具协议。Flyflor 市场第一版把两者放在同一个生态入口里，但运行边界不同。",
                    bullets: [
                        "Skill 描述触发条件、输入边界、产出和验证方式。",
                        "MCP server 需要清晰 transport、approval、recover 策略。",
                        "Flyflor 本身支持 OpenClaw 与 Hermes 生态接入，市场中会作为官方兼容条目展示。",
                    ],
                    code: "flyflor skill install openclaw-adapter\nflyflor mcp add hermes-agent",
                    title: "Skill 与 MCP 生态",
                },
            ],
            title: "开发者文档",
        },
        market: {
            body: "Skill、MCP、OpenClaw 和 Hermes 兼容能力统一进入市场。第一版提供官方精选、安装命令和源码入口，后续接入发布、评分和版本治理。",
            downloads: "下载",
            install: "安装命令",
            mcp: "MCP",
            skill: "Skill",
            source: "源码",
            stars: "收藏",
            title: "插件市场",
        },
        bbs: {
            admin: "管理",
            announcements: "官方公告",
            body: "开发者社区用于沉淀公告、问题、经验和生态共创。这里不再拆 Skill/MCP 分区，所有讨论进入同一个信息流。",
            bodyPlaceholder: "写下你的集成经验、问题上下文或方案说明",
            leaderboard: "贡献榜",
            loginPrompt: "登录后发布新主题",
            newTopic: "发布主题",
            replies: "回复",
            submit: "发布",
            title: "开发者社区",
            titlePlaceholder: "主题标题",
            views: "浏览",
        },
        footer: {
            docs: "Docs",
            repo: "GitHub",
            tagline: "让智能体可观察、可中断、可恢复、可审计。",
        },
    },
    en: {
        locale: "en",
        languageLabel: "English",
        alternateLabel: "中文",
        repoUrl: githubUrl,
        nav: [
            {
                href: "/en",
                label: "Home",
            },
            {
                href: "/en/about",
                label: "About",
            },
            {
                href: "/en/docs",
                label: "Docs",
            },
            {
                href: "/en/market",
                label: "Market",
            },
            {
                href: "/en/bbs",
                label: "Community",
            },
        ],
        auth: {
            accountTitle: "Developer account",
            authCopy: "Sign in to post, save market entries, and connect a GitHub developer identity.",
            email: "Email",
            github: "Continue with GitHub",
            hasAccount: "Already have an account?",
            login: "Login",
            logout: "Logout",
            name: "Name",
            noAccount: "No account yet?",
            password: "Password",
            register: "Register",
        },
        theme: {
            dark: "Dark",
            label: "Theme",
            light: "Light",
            system: "System",
        },
        hero: {
            eyebrow: "Agent OS for Real Work",
            primaryAction: "Install",
            secondaryAction: "Read docs",
            sourceAction: "GitHub source",
            subtitle:
                "Flyflor is a Bun + TypeScript agent runtime that organizes channels, memory, blackboard work, sandbox approval, MCP, Skill, and multi-provider models into an observable, recoverable Agent OS.",
            title: "Flyflor",
        },
        install: {
            blocks: installBlocksEn,
            body: "Start from one command or run directly from GitHub source. Configuration stays in JSONC instead of leaking provider, model, and channel behavior into ad hoc environment variables.",
            title: "One-line install",
        },
        agent: {
            body: "Flyflor is not a chat wrapper. It separates runtime, gateway, blackboard, sandbox, memory, and MCP into explicit operating boundaries.",
            items: [
                {
                    body: "CLI, TUI, webhooks, Telegram, Discord, Slack, Feishu, WeCom, and more normalize into GatewayMessage.",
                    title: "Multi-channel Gateway",
                },
                {
                    body: "Complex tasks enter the blackboard, where workers discuss within explicit boundaries before runtime executes.",
                    title: "Blackboard collaboration",
                },
                {
                    body: "Shell, MCP, plugins, and tools share SandboxPolicy so side effects can be approved and audited.",
                    title: "Sandbox approval",
                },
                {
                    body: "brain.db stores append-only life events while Crystal promotes proven experience into reusable Gems.",
                    title: "Long-term memory",
                },
            ],
            title: "Agent capabilities",
        },
        about: {
            body: "The project philosophy is convention over configuration, centralized protocol governance, model-owned semantic judgment, and runtime-owned side-effect boundaries.",
            principles: [
                {
                    body: "app.ts stays thin, and dependency injection is explicitly wired in the composition root without reflection scanning.",
                    title: "Thin entrypoint",
                },
                {
                    body: "Structured blocks, enums, and events are registered centrally while business modules validate only payloads.",
                    title: "Protocol first",
                },
                {
                    body: "Business semantics do not use keywords or includes; they come from model-returned structured fields or dedicated JSON prompts.",
                    title: "Zero text matching",
                },
            ],
            title: "Why Flyflor",
        },
        docs: {
            body: "This is not a thin marketing summary. The first version documents the executable path: install, configure, run, understand boundaries, and connect Skill/MCP ecosystems including OpenClaw and Hermes.",
            sections: [
                {
                    body: "Install the binary, create local config, then verify provider, templates, memory, and gateway state with doctor/status.",
                    bullets: [
                        "Config is fixed at ~/.flyflor/config.jsonc; Docker dev uses ./docker/config/config.jsonc.",
                        "Do not push provider, model, channel credentials, or sandbox policy into business environment variables.",
                        "Run doctor before entering chat or TUI on a new machine.",
                    ],
                    code: "curl -fsSL https://flyflor.dev/install.sh | sh\nflyflor doctor\nflyflor status\nflyflor chat",
                    title: "Quick start",
                },
                {
                    body: "Flyflor uses built-in default profiles plus user overrides. New vendors start with empty config and default model lists, while runtime consumes normalized provider profiles.",
                    bullets: [
                        "Provider, model, channel registry, and gateway behavior come from JSONC or secrets providers.",
                        "Business modules never read secrets directly or compile secrets into binaries.",
                        "Defaults live in code as conventions; config only overrides differences.",
                    ],
                    code: "{\n    \"providers\": {\n        \"default\": \"local\",\n        \"profiles\": {\n            \"local\": {\n                \"models\": [\"llama3.2\"]\n            }\n        }\n    }\n}",
                    title: "Configuration model",
                },
                {
                    body: "The entrypoint only starts the FlyFlor class. The composition root wires providers and tokens explicitly, then runtime delegates work to gateway, blackboard, sandbox, memory, and workers.",
                    bullets: [
                        "Runtime owns turn lifecycle and tool orchestration, not long-term memory strategy.",
                        "Blackboard handles complex collaboration and returns a converged result to runtime.",
                        "Crystal consolidates validated experience; Neural maintains working memory, long-term graph, and slow paths.",
                    ],
                    title: "Architecture boundaries",
                },
                {
                    body: "Shell, file writes, plugins, MCP, and network tools go through the same sandbox capability model. Business modules must not bypass approval paths.",
                    bullets: [
                        "Side-effecting tools declare capability, lifecycle, and auditable events.",
                        "High-risk actions enter approval or rejection paths instead of local ad hoc checks.",
                        "Public events and protocols remain JSON-serializable for recovery across channels.",
                    ],
                    title: "Tools and sandbox",
                },
                {
                    body: "Skill is an installable reusable workflow capability. MCP is an external tool protocol. Flyflor presents both in one ecosystem surface while keeping their runtime boundaries separate.",
                    bullets: [
                        "Skills describe trigger conditions, input boundaries, output shape, and verification.",
                        "MCP servers need explicit transport, approval, and recovery strategies.",
                        "Flyflor supports OpenClaw and Hermes ecosystem adapters as first-class market entries.",
                    ],
                    code: "flyflor skill install openclaw-adapter\nflyflor mcp add hermes-agent",
                    title: "Skill and MCP ecosystem",
                },
            ],
            title: "Developer documentation",
        },
        market: {
            body: "Skill, MCP, OpenClaw, and Hermes-compatible capabilities live in one market. The first version ships curated entries, install commands, and source links before publishing and rating flows.",
            downloads: "Downloads",
            install: "Install command",
            mcp: "MCP",
            skill: "Skill",
            source: "Source",
            stars: "Stars",
            title: "Plugin market",
        },
        bbs: {
            admin: "Admin",
            announcements: "Official announcements",
            body: "The developer community collects announcements, questions, integration notes, and ecosystem work in one feed. Skill and MCP posts are no longer split into separate boards.",
            bodyPlaceholder: "Share integration notes, context, or a proposed approach",
            leaderboard: "Leaderboard",
            loginPrompt: "Login to publish a topic",
            newTopic: "New topic",
            replies: "replies",
            submit: "Publish",
            title: "Developer Community",
            titlePlaceholder: "Topic title",
            views: "views",
        },
        footer: {
            docs: "Docs",
            repo: "GitHub",
            tagline: "Build agents that can be observed, interrupted, resumed, and audited.",
        },
    },
};
