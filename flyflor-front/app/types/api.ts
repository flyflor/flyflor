export type AuthUser = {
    avatarUrl: string | null;
    createdAt: string;
    email: string;
    id: number;
    isAdmin: boolean;
    name: string;
};

export type Board = {
    description_en: string;
    description_zh: string;
    id: number;
    key: "skill" | "mcp";
    name_en: string;
    name_zh: string;
};

export type Topic = {
    author_name: string;
    board_key: string | null;
    body_en: string;
    body_zh: string;
    created_at: string;
    id: number;
    likes: number;
    replies: number;
    title_en: string;
    title_zh: string;
    views: number;
};

export type Announcement = {
    body_en: string;
    body_zh: string;
    created_at: string;
    id: number;
    is_pinned: number;
    tag_en: string;
    tag_zh: string;
    title_en: string;
    title_zh: string;
};

export type SiteSettings = {
    accent_color: string;
    community_subtitle_en: string;
    community_subtitle_zh: string;
    community_title_en: string;
    community_title_zh: string;
    id: number;
    updated_at: string;
};

export type MarketItem = {
    created_at: string;
    description_en: string;
    description_zh: string;
    downloads: number;
    id: number;
    install_command: string;
    kind: "skill" | "mcp";
    name: string;
    repo_url: string;
    slug: string;
    stars: number;
    summary_en: string;
    summary_zh: string;
};
