import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type UserRow = {
    id: number;
    email: string;
    name: string;
    password_hash: string | null;
    github_id: string | null;
    avatar_url: string | null;
    is_admin: number;
    created_at: string;
};

type SessionRow = {
    token: string;
    user_id: number;
    expires_at: string;
};

type BoardRow = {
    id: number;
    key: string;
    name_zh: string;
    name_en: string;
    description_zh: string;
    description_en: string;
};

type AdminUserRow = UserRow & {
    topic_count: number;
};

type AdminTopicRow = TopicRow & {
    author_avatar_url: string | null;
    author_email: string | null;
    board_description_en: string | null;
    board_description_zh: string | null;
    board_name_en: string | null;
    board_name_zh: string | null;
};

type AdminCommentRow = CommentRow & {
    author_email: string | null;
    board_key: string | null;
    board_name_en: string | null;
    board_name_zh: string | null;
    topic_title_en: string;
    topic_title_zh: string;
};

type TopicRow = {
    id: number;
    board_key: string | null;
    author_user_id: number | null;
    title_zh: string;
    title_en: string;
    body_zh: string;
    body_en: string;
    author_name: string;
    replies: number;
    views: number;
    likes: number;
    created_at: string;
};

type CommentRow = {
    id: number;
    topic_id: number;
    author_user_id: number | null;
    author_name: string;
    body_zh: string;
    body_en: string;
    created_at: string;
};

type AnnouncementRow = {
    id: number;
    title_zh: string;
    title_en: string;
    body_zh: string;
    body_en: string;
    tag_zh: string;
    tag_en: string;
    is_pinned: number;
    created_at: string;
};

type SiteSettingsRow = {
    id: number;
    accent_color: string;
    community_title_zh: string;
    community_title_en: string;
    community_subtitle_zh: string;
    community_subtitle_en: string;
    updated_at: string;
};

type MarketItemRow = {
    id: number;
    kind: "skill" | "mcp";
    slug: string;
    name: string;
    summary_zh: string;
    summary_en: string;
    description_zh: string;
    description_en: string;
    install_command: string;
    repo_url: string;
    stars: number;
    downloads: number;
    created_at: string;
};

type MarketSeed = {
    descriptionEn: string;
    descriptionZh: string;
    downloads: number;
    installCommand: string;
    kind: "skill" | "mcp";
    name: string;
    repoUrl: string;
    slug: string;
    stars: number;
    summaryEn: string;
    summaryZh: string;
};

const dataDirectory = join(process.cwd(), ".data");
const databasePath = join(dataDirectory, "flyflor.front.sqlite");

mkdirSync(dataDirectory, { recursive: true });

export const database = new Database(databasePath, { create: true });

database.exec("PRAGMA journal_mode = WAL;");
database.exec("PRAGMA foreign_keys = ON;");

database.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        password_hash TEXT,
        github_id TEXT UNIQUE,
        avatar_url TEXT,
        is_admin INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS boards (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        name_zh TEXT NOT NULL,
        name_en TEXT NOT NULL,
        description_zh TEXT NOT NULL,
        description_en TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS topics (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        board_key TEXT NOT NULL REFERENCES boards(key) ON DELETE CASCADE,
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        title_zh TEXT NOT NULL,
        title_en TEXT NOT NULL,
        body_zh TEXT NOT NULL,
        body_en TEXT NOT NULL,
        author_name TEXT NOT NULL,
        replies INTEGER NOT NULL DEFAULT 0,
        views INTEGER NOT NULL DEFAULT 0,
        likes INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS comments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        topic_id INTEGER NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
        author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        author_name TEXT NOT NULL,
        body_zh TEXT NOT NULL,
        body_en TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS announcements (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title_zh TEXT NOT NULL,
        title_en TEXT NOT NULL,
        body_zh TEXT NOT NULL,
        body_en TEXT NOT NULL,
        tag_zh TEXT NOT NULL,
        tag_en TEXT NOT NULL,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS site_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        accent_color TEXT NOT NULL,
        community_title_zh TEXT NOT NULL,
        community_title_en TEXT NOT NULL,
        community_subtitle_zh TEXT NOT NULL,
        community_subtitle_en TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS market_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kind TEXT NOT NULL CHECK (kind IN ('skill', 'mcp')),
        slug TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        summary_zh TEXT NOT NULL,
        summary_en TEXT NOT NULL,
        description_zh TEXT NOT NULL,
        description_en TEXT NOT NULL,
        install_command TEXT NOT NULL,
        repo_url TEXT NOT NULL,
        stars INTEGER NOT NULL DEFAULT 0,
        downloads INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
`);

const tableColumns = {
    topics: database.query("PRAGMA table_info(topics)").all() as Array<{ name: string }>,
    users: database.query("PRAGMA table_info(users)").all() as Array<{ name: string }>,
};

if (!tableColumns.users.some((column) => column.name === "is_admin")) {
    database.exec("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;");
}

if (!tableColumns.topics.some((column) => column.name === "author_user_id")) {
    database.exec("ALTER TABLE topics ADD COLUMN author_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL;");
    database.exec(`
        UPDATE topics
        SET author_user_id = (
            SELECT id FROM users WHERE users.name = topics.author_name LIMIT 1
        )
        WHERE author_user_id IS NULL
    `);
}

if (!tableColumns.topics.some((column) => column.name === "views")) {
    database.exec("ALTER TABLE topics ADD COLUMN views INTEGER NOT NULL DEFAULT 0;");
}

if (!tableColumns.topics.some((column) => column.name === "likes")) {
    database.exec("ALTER TABLE topics ADD COLUMN likes INTEGER NOT NULL DEFAULT 0;");
}

const adminCount = database.query("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get() as { count: number };

if (adminCount.count === 0) {
    database.exec("UPDATE users SET is_admin = 1 WHERE id = (SELECT MIN(id) FROM users);");
}

const boardCount = database.query("SELECT COUNT(*) AS count FROM boards").get() as { count: number };

if (boardCount.count === 0) {
    const insertBoard = database.query(`
        INSERT INTO boards (key, name_zh, name_en, description_zh, description_en)
        VALUES ($key, $nameZh, $nameEn, $descriptionZh, $descriptionEn)
    `);

    insertBoard.run({
        $key: "skill",
        $nameZh: "Skill 区",
        $nameEn: "Skill Board",
        $descriptionZh: "沉淀可复用技能、提示词工作流、安装说明和使用边界。",
        $descriptionEn: "Share reusable skills, prompt workflows, install notes, and operating boundaries.",
    });

    insertBoard.run({
        $key: "mcp",
        $nameZh: "MCP 区",
        $nameEn: "MCP Board",
        $descriptionZh: "讨论 MCP server、工具审批、传输恢复和真实集成经验。",
        $descriptionEn: "Discuss MCP servers, tool approval, transport recovery, and integration reports.",
    });

    const insertTopic = database.query(`
        INSERT INTO topics (
            board_key,
            title_zh,
            title_en,
            body_zh,
            body_en,
            author_name,
            replies
        )
        VALUES (
            $boardKey,
            $titleZh,
            $titleEn,
            $bodyZh,
            $bodyEn,
            $authorName,
            $replies
        )
    `);

    insertTopic.run({
        $authorName: "Flyflor Team",
        $boardKey: "skill",
        $bodyEn: "A thread for publishing Codex-compatible skill packages with install steps and expected boundaries.",
        $bodyZh: "用于发布 Codex 兼容技能包，附安装步骤、触发场景和边界说明。",
        $replies: 8,
        $titleEn: "Share your first Flyflor skill",
        $titleZh: "发布你的第一个 Flyflor Skill",
    });

    insertTopic.run({
        $authorName: "MCP Maintainer",
        $boardKey: "mcp",
        $bodyEn: "Collecting examples for stdio MCP servers, approval policy, and recovery notes.",
        $bodyZh: "收集 stdio MCP server、审批策略和恢复经验的真实案例。",
        $replies: 5,
        $titleEn: "MCP server integration notes",
        $titleZh: "MCP Server 集成记录",
    });
}

database
    .query(`
        INSERT OR IGNORE INTO site_settings (
            id,
            accent_color,
            community_title_zh,
            community_title_en,
            community_subtitle_zh,
            community_subtitle_en
        )
        VALUES (
            1,
            '#b65cff',
            '开发者社区',
            'Developer Community',
            '公告、经验、问题和生态共创都集中在一个信息流里，不再按 Skill/MCP 分区。',
            'Announcements, notes, questions, and ecosystem work share one focused feed instead of split boards.'
        )
    `)
    .run();

const insertAnnouncement = database.query(`
    INSERT OR IGNORE INTO announcements (
        id,
        title_zh,
        title_en,
        body_zh,
        body_en,
        tag_zh,
        tag_en,
        is_pinned
    )
    VALUES (
        $id,
        $titleZh,
        $titleEn,
        $bodyZh,
        $bodyEn,
        $tagZh,
        $tagEn,
        $isPinned
    )
`);

insertAnnouncement.run({
    $bodyEn: "The community feed now includes official announcements, ecosystem updates, and developer posts in one place.",
    $bodyZh: "开发者社区已改为单一信息流，官方公告、生态更新和开发者帖子集中展示。",
    $id: 1,
    $isPinned: 1,
    $tagEn: "Release",
    $tagZh: "发布",
    $titleEn: "Developer community is open",
    $titleZh: "开发者社区开放",
});

insertAnnouncement.run({
    $bodyEn: "Flyflor market has added OpenClaw adapter and Hermes MCP bridge entries for early integration testing.",
    $bodyZh: "Flyflor 市场新增 OpenClaw adapter 与 Hermes MCP bridge，供早期集成测试。",
    $id: 2,
    $isPinned: 0,
    $tagEn: "Ecosystem",
    $tagZh: "生态",
    $titleEn: "OpenClaw and Hermes support",
    $titleZh: "OpenClaw 与 Hermes 支持",
});

const commentCount = database.query("SELECT COUNT(*) AS count FROM comments").get() as { count: number };

if (commentCount.count === 0) {
    const seedTopics = database.query("SELECT id, board_key FROM topics ORDER BY id ASC LIMIT 2").all() as Array<{
        board_key: string;
        id: number;
    }>;
    const insertComment = database.query(`
        INSERT INTO comments (
            topic_id,
            author_name,
            body_zh,
            body_en
        )
        VALUES (
            $topicId,
            $authorName,
            $bodyZh,
            $bodyEn
        )
    `);

    for (const topic of seedTopics) {
        insertComment.run({
            $authorName: topic.board_key === "skill" ? "Skill Builder" : "Runtime Maintainer",
            $bodyEn:
                topic.board_key === "skill"
                    ? "Please include trigger rules and a short verification step when sharing a skill."
                    : "Transport recovery notes are especially useful when documenting MCP integrations.",
            $bodyZh:
                topic.board_key === "skill"
                    ? "分享技能时建议包含触发规则和一条简短验证步骤。"
                    : "记录 MCP 集成时，传输恢复经验尤其有价值。",
            $topicId: topic.id,
        });
    }
}

const marketSeeds: MarketSeed[] = [
    {
        descriptionEn: "Turns repository rules, verification criteria, and implementation boundaries into a reusable coding discipline.",
        descriptionZh: "把仓库规则、验收标准和实现边界整理成可复用的编码纪律。",
        downloads: 1240,
        installCommand: "flyflor skill install karpathy-guidelines",
        kind: "skill",
        name: "karpathy-guidelines",
        repoUrl: "https://github.com/flyflor/flyflor",
        slug: "karpathy-guidelines",
        stars: 96,
        summaryEn: "Cautious, surgical coding workflow for agent developers.",
        summaryZh: "面向 agent 开发者的克制、可验证编码工作流。",
    },
    {
        descriptionEn: "A reference MCP connector for local workspace tools with explicit sandbox boundaries.",
        descriptionZh: "面向本地工作区工具的 MCP 连接器参考实现，带明确沙箱边界。",
        downloads: 860,
        installCommand: "flyflor mcp add workspace-tools",
        kind: "mcp",
        name: "workspace-tools",
        repoUrl: "https://github.com/flyflor/flyflor",
        slug: "workspace-tools",
        stars: 74,
        summaryEn: "Local workspace MCP tools for review, build, and file inspection.",
        summaryZh: "用于审查、构建和文件检查的本地工作区 MCP 工具。",
    },
    {
        descriptionEn: "A skill template for building bilingual documentation routes and release-ready site copy.",
        descriptionZh: "用于生成双语文档路由和发布级官网文案的技能模板。",
        downloads: 540,
        installCommand: "flyflor skill install bilingual-docs",
        kind: "skill",
        name: "bilingual-docs",
        repoUrl: "https://github.com/flyflor/flyflor",
        slug: "bilingual-docs",
        stars: 42,
        summaryEn: "Documentation skill for Chinese and English product sites.",
        summaryZh: "服务中英文产品站的文档技能。",
    },
    {
        descriptionEn: "OpenClaw compatibility layer for exposing claw-style agent capabilities as Flyflor skills with explicit sandbox policy.",
        descriptionZh: "OpenClaw 兼容层，把 claw 风格 agent 能力接入为 Flyflor Skill，并保留明确沙箱策略。",
        downloads: 980,
        installCommand: "flyflor skill install openclaw-adapter",
        kind: "skill",
        name: "openclaw-adapter",
        repoUrl: "https://github.com/flyflor/flyflor",
        slug: "openclaw-adapter",
        stars: 88,
        summaryEn: "OpenClaw-compatible skill adapter for Flyflor runtime.",
        summaryZh: "面向 Flyflor runtime 的 OpenClaw 兼容 Skill 适配器。",
    },
    {
        descriptionEn: "Hermes agent bridge for MCP-style execution, model routing, and recoverable tool calls inside Flyflor.",
        descriptionZh: "Hermes agent 桥接能力，把 MCP 风格执行、模型路由和可恢复工具调用接入 Flyflor。",
        downloads: 1120,
        installCommand: "flyflor mcp add hermes-agent",
        kind: "mcp",
        name: "hermes-agent",
        repoUrl: "https://github.com/flyflor/flyflor",
        slug: "hermes-agent",
        stars: 102,
        summaryEn: "Hermes-compatible MCP bridge for multi-agent execution.",
        summaryZh: "支持 Hermes 的多智能体 MCP 桥接插件。",
    },
];

const insertMarketItem = database.query(`
    INSERT OR IGNORE INTO market_items (
        kind,
        slug,
        name,
        summary_zh,
        summary_en,
        description_zh,
        description_en,
        install_command,
        repo_url,
        stars,
        downloads
    )
    VALUES (
        $kind,
        $slug,
        $name,
        $summaryZh,
        $summaryEn,
        $descriptionZh,
        $descriptionEn,
        $installCommand,
        $repoUrl,
        $stars,
        $downloads
    )
`);

for (const seed of marketSeeds) {
    insertMarketItem.run({
        $descriptionEn: seed.descriptionEn,
        $descriptionZh: seed.descriptionZh,
        $downloads: seed.downloads,
        $installCommand: seed.installCommand,
        $kind: seed.kind,
        $name: seed.name,
        $repoUrl: seed.repoUrl,
        $slug: seed.slug,
        $stars: seed.stars,
        $summaryEn: seed.summaryEn,
        $summaryZh: seed.summaryZh,
    });
}

export function getUserBySessionToken(token: string): UserRow | null {
    const session = database
        .query("SELECT token, user_id, expires_at FROM sessions WHERE token = $token")
        .get({ $token: token }) as SessionRow | null;

    if (!session || new Date(session.expires_at).getTime() <= Date.now()) {
        return null;
    }

    return database.query("SELECT * FROM users WHERE id = $id").get({ $id: session.user_id }) as UserRow | null;
}

export function serializeUser(user: UserRow) {
    return {
        avatarUrl: user.avatar_url,
        createdAt: user.created_at,
        email: user.email,
        id: user.id,
        isAdmin: user.is_admin === 1,
        name: user.name,
    };
}

export function serializeAdminUser(user: AdminUserRow) {
    return {
        ...serializeUser(user),
        topicCount: user.topic_count,
    };
}

export function listBoards(): BoardRow[] {
    return database.query("SELECT * FROM boards ORDER BY id ASC").all() as BoardRow[];
}

export function listBoardsWithTopicCounts(): Array<BoardRow & { topic_count: number }> {
    return database
        .query(`
            SELECT
                boards.*,
                COUNT(topics.id) AS topic_count
            FROM boards
            LEFT JOIN topics ON topics.board_key = boards.key
            GROUP BY boards.id
            ORDER BY boards.id ASC
        `)
        .all() as Array<BoardRow & { topic_count: number }>;
}

export function listAdminUsers(): ReturnType<typeof serializeAdminUser>[] {
    const users = database
        .query(`
            SELECT
                users.*,
                COUNT(topics.id) AS topic_count
            FROM users
            LEFT JOIN topics ON topics.author_user_id = users.id
            GROUP BY users.id
            ORDER BY users.is_admin DESC, users.created_at DESC, users.id DESC
        `)
        .all() as AdminUserRow[];

    return users.map(serializeAdminUser);
}

export function listAdminTopics(): AdminTopicRow[] {
    return database
        .query(`
            SELECT
                topics.*,
                boards.description_en AS board_description_en,
                boards.description_zh AS board_description_zh,
                boards.name_en AS board_name_en,
                boards.name_zh AS board_name_zh,
                users.avatar_url AS author_avatar_url,
                users.email AS author_email
            FROM topics
            LEFT JOIN boards ON boards.key = topics.board_key
            LEFT JOIN users ON users.id = topics.author_user_id
            ORDER BY topics.created_at DESC, topics.id DESC
        `)
        .all() as AdminTopicRow[];
}

export function listAdminComments(): AdminCommentRow[] {
    return database
        .query(`
            SELECT
                comments.*,
                topics.board_key,
                topics.title_en AS topic_title_en,
                topics.title_zh AS topic_title_zh,
                boards.name_en AS board_name_en,
                boards.name_zh AS board_name_zh,
                users.email AS author_email
            FROM comments
            INNER JOIN topics ON topics.id = comments.topic_id
            LEFT JOIN boards ON boards.key = topics.board_key
            LEFT JOIN users ON users.id = comments.author_user_id
            ORDER BY comments.created_at DESC, comments.id DESC
        `)
        .all() as AdminCommentRow[];
}

export function countAdminUsers(): number {
    const row = database.query("SELECT COUNT(*) AS count FROM users WHERE is_admin = 1").get() as { count: number };

    return row.count;
}

export function listTopics(boardKey?: string): TopicRow[] {
    if (boardKey) {
        return database
            .query("SELECT * FROM topics WHERE board_key = $boardKey ORDER BY created_at DESC, id DESC")
            .all({ $boardKey: boardKey }) as TopicRow[];
    }

    return database.query("SELECT * FROM topics ORDER BY created_at DESC, id DESC").all() as TopicRow[];
}

export function listAnnouncements(): AnnouncementRow[] {
    return database.query("SELECT * FROM announcements ORDER BY is_pinned DESC, created_at DESC, id DESC").all() as AnnouncementRow[];
}

export function getSiteSettings(): SiteSettingsRow {
    return database.query("SELECT * FROM site_settings WHERE id = 1").get() as SiteSettingsRow;
}

export function listMarketItems(kind?: "skill" | "mcp"): MarketItemRow[] {
    if (kind) {
        return database
            .query("SELECT * FROM market_items WHERE kind = $kind ORDER BY stars DESC, downloads DESC")
            .all({ $kind: kind }) as MarketItemRow[];
    }

    return database.query("SELECT * FROM market_items ORDER BY kind ASC, stars DESC, downloads DESC").all() as MarketItemRow[];
}
