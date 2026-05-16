<template>
    <div class="page-shell">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main>
            <section class="page-hero">
                <p class="eyebrow">Admin</p>
                <h1>{{ locale === "zh" ? "管理模式" : "Admin mode" }}</h1>
                <p>
                    {{
                        locale === "zh"
                            ? "集中管理社区配置、官方公告、自定义板块和开发者账号。"
                            : "Manage community settings, official announcements, custom boards, and developer accounts."
                    }}
                </p>
            </section>

            <section v-if="user?.isAdmin" class="admin-layout">
                <div class="admin-status surface-panel">
                    <span>{{ locale === "zh" ? "当前管理员" : "Current admin" }}</span>
                    <strong>{{ user.email }}</strong>
                    <small v-if="statusMessage">{{ statusMessage }}</small>
                </div>

                <form class="surface-panel admin-card" @submit.prevent="saveSettings">
                    <h2>{{ locale === "zh" ? "站点配置" : "Site settings" }}</h2>
                    <label>
                        <span>{{ locale === "zh" ? "主题色" : "Accent color" }}</span>
                        <input v-model="settingsForm.accentColor" type="color" />
                    </label>
                    <label>
                        <span>中文标题</span>
                        <input v-model="settingsForm.communityTitleZh" />
                    </label>
                    <label>
                        <span>English title</span>
                        <input v-model="settingsForm.communityTitleEn" />
                    </label>
                    <label>
                        <span>中文副标题</span>
                        <textarea v-model="settingsForm.communitySubtitleZh"></textarea>
                    </label>
                    <label>
                        <span>English subtitle</span>
                        <textarea v-model="settingsForm.communitySubtitleEn"></textarea>
                    </label>
                    <button class="button button--primary" type="submit">
                        <Icon name="lucide:save" />
                        {{ locale === "zh" ? "保存配置" : "Save settings" }}
                    </button>
                </form>

                <form class="surface-panel admin-card" @submit.prevent="publishAnnouncement">
                    <h2>{{ locale === "zh" ? "官方公告" : "Official announcement" }}</h2>
                    <label>
                        <span>中文标签</span>
                        <input v-model="announcementForm.tagZh" />
                    </label>
                    <label>
                        <span>English tag</span>
                        <input v-model="announcementForm.tagEn" />
                    </label>
                    <label>
                        <span>中文标题</span>
                        <input v-model="announcementForm.titleZh" required />
                    </label>
                    <label>
                        <span>English title</span>
                        <input v-model="announcementForm.titleEn" required />
                    </label>
                    <label>
                        <span>中文内容</span>
                        <textarea v-model="announcementForm.bodyZh" required></textarea>
                    </label>
                    <label>
                        <span>English body</span>
                        <textarea v-model="announcementForm.bodyEn" required></textarea>
                    </label>
                    <label class="checkbox-row">
                        <input v-model="announcementForm.isPinned" type="checkbox" />
                        <span>{{ locale === "zh" ? "置顶公告" : "Pinned" }}</span>
                    </label>
                    <button class="button button--secondary" type="submit">
                        <Icon name="lucide:megaphone" />
                        {{ locale === "zh" ? "发布公告" : "Publish" }}
                    </button>
                </form>

                <section class="surface-panel admin-card admin-card--wide">
                    <div class="panel-head">
                        <div>
                            <h2>{{ locale === "zh" ? "自定义板块" : "Custom boards" }}</h2>
                            <p>{{ locale === "zh" ? "板块 key 创建后保持稳定；已有帖子的板块不能删除。" : "Board keys stay stable after creation. Boards with topics cannot be deleted." }}</p>
                        </div>
                    </div>

                    <form class="board-create" @submit.prevent="createBoard">
                        <input v-model="boardForm.key" placeholder="key: agent.news" required />
                        <input v-model="boardForm.nameZh" placeholder="中文名称" required />
                        <input v-model="boardForm.nameEn" placeholder="English name" required />
                        <input v-model="boardForm.descriptionZh" placeholder="中文说明" required />
                        <input v-model="boardForm.descriptionEn" placeholder="English description" required />
                        <button class="button button--primary" type="submit">
                            <Icon name="lucide:plus" />
                            {{ locale === "zh" ? "新增板块" : "Add board" }}
                        </button>
                    </form>

                    <div class="table-list">
                        <form v-for="board in boardForms" :key="board.id" class="table-row board-row" @submit.prevent="updateBoard(board)">
                            <strong>{{ board.key }}</strong>
                            <input v-model="board.nameZh" aria-label="中文名称" />
                            <input v-model="board.nameEn" aria-label="English name" />
                            <input v-model="board.descriptionZh" aria-label="中文说明" />
                            <input v-model="board.descriptionEn" aria-label="English description" />
                            <span>{{ board.topicCount }} {{ locale === "zh" ? "帖" : "topics" }}</span>
                            <div class="row-actions">
                                <button class="icon-button" type="submit" :title="locale === 'zh' ? '保存' : 'Save'">
                                    <Icon name="lucide:save" />
                                </button>
                                <button
                                    class="icon-button"
                                    type="button"
                                    :disabled="board.topicCount > 0"
                                    :title="locale === 'zh' ? '删除空板块' : 'Delete empty board'"
                                    @click="deleteBoard(board.id)"
                                >
                                    <Icon name="lucide:trash-2" />
                                </button>
                            </div>
                        </form>
                    </div>
                </section>

                <section class="surface-panel admin-card admin-card--wide">
                    <div class="panel-head">
                        <div>
                            <h2>{{ locale === "zh" ? "账号管理" : "Account management" }}</h2>
                            <p>{{ locale === "zh" ? "可修改昵称、管理员权限，并删除非当前账号。" : "Edit names, admin access, and delete accounts other than your own." }}</p>
                        </div>
                    </div>

                    <div class="table-list">
                        <form v-for="account in userForms" :key="account.id" class="table-row user-row" @submit.prevent="updateAccount(account)">
                            <strong>{{ account.email }}</strong>
                            <input v-model="account.name" aria-label="Name" />
                            <label class="checkbox-row">
                                <input v-model="account.isAdmin" type="checkbox" :disabled="account.id === user.id" />
                                <span>{{ locale === "zh" ? "管理员" : "Admin" }}</span>
                            </label>
                            <span>{{ account.topicCount }} {{ locale === "zh" ? "帖" : "topics" }}</span>
                            <small>{{ formatDate(account.createdAt) }}</small>
                            <div class="row-actions">
                                <button class="icon-button" type="submit" :title="locale === 'zh' ? '保存' : 'Save'">
                                    <Icon name="lucide:save" />
                                </button>
                                <button
                                    class="icon-button"
                                    type="button"
                                    :disabled="account.id === user.id"
                                    :title="locale === 'zh' ? '删除账号' : 'Delete account'"
                                    @click="deleteAccount(account.id)"
                                >
                                    <Icon name="lucide:user-x" />
                                </button>
                            </div>
                        </form>
                    </div>
                </section>
            </section>

            <section v-else class="admin-denied surface-panel">
                <Icon name="lucide:shield-alert" />
                <strong>{{ locale === "zh" ? "需要管理员权限" : "Admin access required" }}</strong>
                <NuxtLink class="button button--primary" :to="`/${locale}/auth/login`">
                    {{ content.auth.login }}
                </NuxtLink>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
import type { AdminUser, Board, SiteSettings } from "~/types/api";

type BoardForm = {
    descriptionEn: string;
    descriptionZh: string;
    id: number;
    key: string;
    nameEn: string;
    nameZh: string;
    topicCount: number;
};

type UserForm = AdminUser;

const { alternateLocale, content, locale } = useSiteLocale();
const { refreshUser, user } = useAuth();
const statusMessage = ref("");
const settingsForm = reactive({
    accentColor: "#b65cff",
    communitySubtitleEn: "",
    communitySubtitleZh: "",
    communityTitleEn: "",
    communityTitleZh: "",
});
const announcementForm = reactive({
    bodyEn: "",
    bodyZh: "",
    isPinned: false,
    tagEn: "Official",
    tagZh: "官方",
    titleEn: "",
    titleZh: "",
});
const boardForm = reactive({
    descriptionEn: "",
    descriptionZh: "",
    key: "",
    nameEn: "",
    nameZh: "",
});
const boardForms = ref<BoardForm[]>([]);
const userForms = ref<UserForm[]>([]);
const { data: settingsData, refresh: refreshSettings } = await useFetch<{ settings: SiteSettings }>("/api/admin/settings", {
    immediate: false,
});
const { data: boardsData, refresh: refreshBoards } = await useFetch<{ boards: Array<Board & { topic_count: number }> }>(
    "/api/admin/boards",
    {
        immediate: false,
    },
);
const { data: usersData, refresh: refreshUsers } = await useFetch<{ users: AdminUser[] }>("/api/admin/users", {
    immediate: false,
});

watchEffect(() => {
    const settings = settingsData.value?.settings;

    if (!settings) {
        return;
    }

    settingsForm.accentColor = settings.accent_color;
    settingsForm.communitySubtitleEn = settings.community_subtitle_en;
    settingsForm.communitySubtitleZh = settings.community_subtitle_zh;
    settingsForm.communityTitleEn = settings.community_title_en;
    settingsForm.communityTitleZh = settings.community_title_zh;
});

watchEffect(() => {
    boardForms.value =
        boardsData.value?.boards.map((board) => ({
            descriptionEn: board.description_en,
            descriptionZh: board.description_zh,
            id: board.id,
            key: board.key,
            nameEn: board.name_en,
            nameZh: board.name_zh,
            topicCount: board.topic_count ?? 0,
        })) ?? [];
});

watchEffect(() => {
    userForms.value = usersData.value?.users.map((item) => ({ ...item })) ?? [];
});

watch(
    () => user.value?.isAdmin,
    (isAdmin) => {
        if (!isAdmin) {
            return;
        }

        void refreshAll();
    },
    { immediate: true },
);

async function refreshAll(): Promise<void> {
    await Promise.all([refreshSettings(), refreshBoards(), refreshUsers()]);
}

async function saveSettings(): Promise<void> {
    await $fetch("/api/admin/settings", {
        body: settingsForm,
        method: "POST",
    });
    await refreshSettings();
    markSaved();
}

async function publishAnnouncement(): Promise<void> {
    await $fetch("/api/admin/announcements", {
        body: announcementForm,
        method: "POST",
    });
    announcementForm.bodyEn = "";
    announcementForm.bodyZh = "";
    announcementForm.titleEn = "";
    announcementForm.titleZh = "";
    markSaved();
}

async function createBoard(): Promise<void> {
    await $fetch("/api/admin/boards", {
        body: {
            action: "create",
            ...boardForm,
        },
        method: "POST",
    });
    boardForm.descriptionEn = "";
    boardForm.descriptionZh = "";
    boardForm.key = "";
    boardForm.nameEn = "";
    boardForm.nameZh = "";
    await refreshBoards();
    markSaved();
}

async function updateBoard(board: BoardForm): Promise<void> {
    await $fetch("/api/admin/boards", {
        body: {
            action: "update",
            descriptionEn: board.descriptionEn,
            descriptionZh: board.descriptionZh,
            id: board.id,
            nameEn: board.nameEn,
            nameZh: board.nameZh,
        },
        method: "POST",
    });
    await refreshBoards();
    markSaved();
}

async function deleteBoard(id: number): Promise<void> {
    await $fetch("/api/admin/boards", {
        body: {
            action: "delete",
            id,
        },
        method: "POST",
    });
    await refreshBoards();
    markSaved();
}

async function updateAccount(account: UserForm): Promise<void> {
    await $fetch("/api/admin/users", {
        body: {
            action: "update",
            id: account.id,
            isAdmin: account.isAdmin,
            name: account.name,
        },
        method: "POST",
    });
    await Promise.all([refreshUsers(), refreshUser()]);
    markSaved();
}

async function deleteAccount(id: number): Promise<void> {
    await $fetch("/api/admin/users", {
        body: {
            action: "delete",
            id,
        },
        method: "POST",
    });
    await refreshUsers();
    markSaved();
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en", {
        dateStyle: "medium",
    }).format(new Date(value));
}

function markSaved(): void {
    statusMessage.value = locale.value === "zh" ? "已保存" : "Saved";
    window.setTimeout(() => {
        statusMessage.value = "";
    }, 1800);
}

useSeoMeta({
    title: "Admin",
});
</script>

<style scoped>
.admin-layout {
    align-items: start;
    display: grid;
    gap: 22px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    margin: 0 auto;
    max-width: 1160px;
    padding: 24px 24px 88px;
}

.admin-status,
.admin-card--wide {
    grid-column: 1 / -1;
}

.admin-status {
    align-items: center;
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
    padding: 18px 22px;
}

.admin-status span,
.admin-status small {
    color: var(--color-muted);
    font-weight: 900;
}

.admin-status small {
    margin-left: auto;
}

.admin-card {
    display: grid;
    gap: 14px;
    padding: 24px;
}

.admin-card h2,
.admin-card p {
    margin: 0;
}

.admin-card p {
    color: var(--color-muted);
}

.admin-card label {
    display: grid;
    gap: 8px;
}

.admin-card label span {
    color: var(--color-muted);
    font-weight: 900;
}

.admin-card input[type="color"] {
    min-height: 52px;
    padding: 4px;
}

.panel-head {
    align-items: start;
    display: flex;
    justify-content: space-between;
}

.board-create {
    display: grid;
    gap: 10px;
    grid-template-columns: 0.75fr repeat(4, minmax(0, 1fr)) auto;
}

.table-list {
    border-top: 1px solid var(--color-line);
    display: grid;
    gap: 0;
}

.table-row {
    align-items: center;
    border-bottom: 1px solid var(--color-line);
    display: grid;
    gap: 10px;
    padding: 14px 0;
}

.board-row {
    grid-template-columns: 0.75fr repeat(4, minmax(0, 1fr)) auto auto;
}

.user-row {
    grid-template-columns: minmax(180px, 1fr) minmax(140px, 0.8fr) auto auto auto auto;
}

.table-row strong,
.table-row span,
.table-row small {
    min-width: 0;
    overflow-wrap: anywhere;
}

.table-row span,
.table-row small {
    color: var(--color-muted);
    font-weight: 900;
}

.row-actions {
    display: flex;
    gap: 8px;
}

.icon-button {
    align-items: center;
    background: var(--color-surface-soft);
    border-radius: 6px;
    color: var(--color-text);
    cursor: pointer;
    display: inline-flex;
    height: 38px;
    justify-content: center;
    width: 38px;
}

.icon-button:disabled {
    cursor: not-allowed;
    opacity: 0.42;
}

.checkbox-row {
    align-items: center;
    display: flex;
    gap: 10px;
}

.checkbox-row input {
    min-height: auto;
    width: auto;
}

.admin-denied {
    align-items: center;
    display: grid;
    gap: 18px;
    justify-items: start;
    margin: 24px auto 88px;
    max-width: 560px;
    padding: 28px;
}

.admin-denied svg {
    color: var(--color-cedar);
    font-size: 2rem;
}

@media (max-width: 1040px) {
    .admin-layout,
    .board-create,
    .board-row,
    .user-row {
        grid-template-columns: 1fr;
    }

    .admin-status small {
        margin-left: 0;
    }
}
</style>
