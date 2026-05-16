<template>
    <div class="page-shell admin-shell" :class="{ 'is-sidebar-open': sidebarOpen }">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main class="admin-app">
            <button class="admin-drawer-toggle button button--secondary" type="button" @click="sidebarOpen = !sidebarOpen">
                <Icon :name="sidebarOpen ? 'lucide:x' : 'lucide:panel-left-open'" />
                {{ t("菜单", "Menu") }}
            </button>

            <div class="admin-drawer-backdrop" :class="{ 'is-open': sidebarOpen }" @click="sidebarOpen = false"></div>

            <aside class="admin-drawer surface-panel">
                <div class="admin-drawer__head">
                    <p class="eyebrow">Admin</p>
                    <h1>{{ t("管理控制台", "Admin console") }}</h1>
                    <p>
                        {{
                            t(
                                "集中管理站点配置、公告、板块、用户和帖子，所有列表都可以直接编辑或删除。",
                                "Manage site settings, announcements, boards, users, and topics from one console with inline editing and deletion."
                            )
                        }}
                    </p>
                </div>

                <div class="admin-summary">
                    <article v-for="item in summaryCards" :key="item.label" class="admin-summary__item">
                        <span>{{ item.label }}</span>
                        <strong>{{ item.value }}</strong>
                    </article>
                </div>

                <nav class="admin-nav" aria-label="Admin sections">
                    <button
                        v-for="item in navItems"
                        :key="item.id"
                        :class="{ 'is-active': activeSection === item.id }"
                        type="button"
                        @click="jumpTo(item.id)"
                    >
                        <Icon :name="item.icon" />
                        <span>{{ item.label }}</span>
                        <small>{{ item.count }}</small>
                    </button>
                </nav>

                <div class="admin-drawer__foot">
                    <span>{{ t("当前管理员", "Current admin") }}</span>
                    <strong>{{ user?.email }}</strong>
                    <small v-if="statusMessage">{{ statusMessage }}</small>
                </div>
            </aside>

            <section v-if="user?.isAdmin" class="admin-content">
                <section id="overview" class="admin-section surface-panel">
                    <div class="admin-section__head">
                        <div>
                            <p class="eyebrow">{{ t("概览", "Overview") }}</p>
                            <h2>{{ t("管理总览", "Management summary") }}</h2>
                            <p>{{ t("先看总量，再进具体模块处理，列表都能直接操作。", "Start with totals, then drill into each module. Every list is editable.") }}</p>
                        </div>
                    </div>

                    <div class="metric-grid">
                        <article v-for="item in overviewMetrics" :key="item.label" class="metric-card">
                            <span>{{ item.label }}</span>
                            <strong>{{ item.value }}</strong>
                            <small>{{ item.note }}</small>
                        </article>
                    </div>
                </section>

                <section id="settings" class="admin-section surface-panel">
                    <div class="admin-section__head">
                        <div>
                            <p class="eyebrow">{{ t("站点", "Site") }}</p>
                            <h2>{{ t("站点配置", "Site settings") }}</h2>
                            <p>{{ t("标题、副标题和主题色会直接影响社区首页。", "Titles, subtitles, and the accent color shape the community home page.") }}</p>
                        </div>
                    </div>

                    <form class="admin-form" @submit.prevent="saveSettings">
                        <label>
                            <span>{{ t("主题色", "Accent color") }}</span>
                            <input v-model="settingsForm.accentColor" type="color" />
                        </label>
                        <label>
                            <span>{{ t("中文标题", "Chinese title") }}</span>
                            <input v-model="settingsForm.communityTitleZh" />
                        </label>
                        <label>
                            <span>{{ t("English title", "English title") }}</span>
                            <input v-model="settingsForm.communityTitleEn" />
                        </label>
                        <label>
                            <span>{{ t("中文副标题", "Chinese subtitle") }}</span>
                            <textarea v-model="settingsForm.communitySubtitleZh"></textarea>
                        </label>
                        <label>
                            <span>{{ t("English subtitle", "English subtitle") }}</span>
                            <textarea v-model="settingsForm.communitySubtitleEn"></textarea>
                        </label>
                        <div class="admin-form__actions">
                            <button class="button button--primary" type="submit">
                                <Icon name="lucide:save" />
                                {{ t("保存配置", "Save settings") }}
                            </button>
                        </div>
                    </form>
                </section>

                <section id="announcements" class="admin-section surface-panel">
                    <div class="admin-section__head">
                        <div>
                            <p class="eyebrow">{{ t("公告", "Announcements") }}</p>
                            <h2>{{ t("官方公告", "Official announcements") }}</h2>
                            <p>{{ t("支持新增、编辑、置顶和删除。", "Create, edit, pin, and delete announcements.") }}</p>
                        </div>
                    </div>

                    <form class="admin-form admin-form--compact" @submit.prevent="publishAnnouncement">
                        <label>
                            <span>{{ t("中文标签", "Chinese tag") }}</span>
                            <input v-model="announcementForm.tagZh" />
                        </label>
                        <label>
                            <span>{{ t("English tag", "English tag") }}</span>
                            <input v-model="announcementForm.tagEn" />
                        </label>
                        <label>
                            <span>{{ t("中文标题", "Chinese title") }}</span>
                            <input v-model="announcementForm.titleZh" required />
                        </label>
                        <label>
                            <span>{{ t("English title", "English title") }}</span>
                            <input v-model="announcementForm.titleEn" required />
                        </label>
                        <label>
                            <span>{{ t("中文内容", "Chinese body") }}</span>
                            <textarea v-model="announcementForm.bodyZh" required></textarea>
                        </label>
                        <label>
                            <span>{{ t("English body", "English body") }}</span>
                            <textarea v-model="announcementForm.bodyEn" required></textarea>
                        </label>
                        <label class="checkbox-row">
                            <input v-model="announcementForm.isPinned" type="checkbox" />
                            <span>{{ t("置顶公告", "Pin announcement") }}</span>
                        </label>
                        <div class="admin-form__actions">
                            <button class="button button--secondary" type="submit">
                                <Icon name="lucide:megaphone" />
                                {{ t("发布公告", "Publish announcement") }}
                            </button>
                        </div>
                    </form>

                    <div class="editable-list">
                        <article v-for="announcement in announcementForms" :key="announcement.id" class="editable-card">
                            <div class="editable-card__head">
                                <div>
                                    <p class="eyebrow">{{ announcement.isPinned ? t("置顶", "Pinned") : t("普通", "Normal") }}</p>
                                    <strong>{{ locale === "zh" ? announcement.titleZh : announcement.titleEn }}</strong>
                                </div>
                                <div class="row-actions">
                                    <button class="icon-button" type="button" :title="t('删除', 'Delete')" @click="deleteAnnouncement(announcement.id)">
                                        <Icon name="lucide:trash-2" />
                                    </button>
                                    <button class="icon-button" type="button" :title="t('保存', 'Save')" @click="saveAnnouncement(announcement)">
                                        <Icon name="lucide:save" />
                                    </button>
                                </div>
                            </div>

                            <div class="editable-grid">
                                <label>
                                    <span>{{ t("中文标签", "Chinese tag") }}</span>
                                    <input v-model="announcement.tagZh" />
                                </label>
                                <label>
                                    <span>{{ t("English tag", "English tag") }}</span>
                                    <input v-model="announcement.tagEn" />
                                </label>
                                <label>
                                    <span>{{ t("中文标题", "Chinese title") }}</span>
                                    <input v-model="announcement.titleZh" />
                                </label>
                                <label>
                                    <span>{{ t("English title", "English title") }}</span>
                                    <input v-model="announcement.titleEn" />
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("中文内容", "Chinese body") }}</span>
                                    <textarea v-model="announcement.bodyZh"></textarea>
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("English body", "English body") }}</span>
                                    <textarea v-model="announcement.bodyEn"></textarea>
                                </label>
                                <label class="checkbox-row">
                                    <input v-model="announcement.isPinned" type="checkbox" />
                                    <span>{{ t("置顶", "Pinned") }}</span>
                                </label>
                            </div>
                        </article>
                    </div>
                </section>

                <section id="boards" class="admin-section surface-panel">
                    <div class="admin-section__head">
                        <div>
                            <p class="eyebrow">{{ t("板块", "Boards") }}</p>
                            <h2>{{ t("自定义板块", "Custom boards") }}</h2>
                            <p>{{ t("板块 key 创建后保持稳定，已有帖子时不能删除。", "Board keys stay stable after creation. Boards with topics cannot be deleted.") }}</p>
                        </div>
                    </div>

                    <form class="board-create" @submit.prevent="createBoard">
                        <input v-model="boardForm.key" :placeholder="t('key: agent.news', 'key: agent.news')" required />
                        <input v-model="boardForm.nameZh" :placeholder="t('中文名称', 'Chinese name')" required />
                        <input v-model="boardForm.nameEn" :placeholder="t('English name', 'English name')" required />
                        <input v-model="boardForm.descriptionZh" :placeholder="t('中文说明', 'Chinese description')" required />
                        <input v-model="boardForm.descriptionEn" :placeholder="t('English description', 'English description')" required />
                        <button class="button button--primary" type="submit">
                            <Icon name="lucide:plus" />
                            {{ t("新增板块", "Add board") }}
                        </button>
                    </form>

                    <div class="editable-list">
                        <form v-for="board in boardForms" :key="board.id" class="editable-row" @submit.prevent="updateBoard(board)">
                            <div class="editable-row__meta">
                                <strong>{{ board.key }}</strong>
                                <small>{{ board.topicCount }} {{ t("帖", "topics") }}</small>
                            </div>
                            <div class="editable-grid">
                                <label>
                                    <span>{{ t("中文名称", "Chinese name") }}</span>
                                    <input v-model="board.nameZh" />
                                </label>
                                <label>
                                    <span>{{ t("English name", "English name") }}</span>
                                    <input v-model="board.nameEn" />
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("中文说明", "Chinese description") }}</span>
                                    <input v-model="board.descriptionZh" />
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("English description", "English description") }}</span>
                                    <input v-model="board.descriptionEn" />
                                </label>
                            </div>
                            <div class="row-actions">
                                <button class="icon-button" type="submit" :title="t('保存', 'Save')">
                                    <Icon name="lucide:save" />
                                </button>
                                <button
                                    class="icon-button"
                                    type="button"
                                    :disabled="board.topicCount > 0"
                                    :title="t('删除空板块', 'Delete empty board')"
                                    @click="deleteBoard(board.id)"
                                >
                                    <Icon name="lucide:trash-2" />
                                </button>
                            </div>
                        </form>
                    </div>
                </section>

                <section id="users" class="admin-section surface-panel">
                    <div class="admin-section__head">
                        <div>
                            <p class="eyebrow">{{ t("用户", "Users") }}</p>
                            <h2>{{ t("账号管理", "Account management") }}</h2>
                            <p>{{ t("可以调整名字、管理员权限，并删除非当前账号。", "Edit names, manage admin access, and delete accounts other than your own.") }}</p>
                        </div>
                        <label class="inline-filter">
                            <span>{{ t("搜索", "Search") }}</span>
                            <input v-model="userQuery" :placeholder="t('邮箱或昵称', 'Email or name')" />
                        </label>
                    </div>

                    <div class="editable-list">
                        <form v-for="account in filteredUsers" :key="account.id" class="editable-row editable-row--user" @submit.prevent="updateAccount(account)">
                            <div class="editable-row__meta">
                                <strong>{{ account.email }}</strong>
                                <small>{{ formatDate(account.createdAt) }}</small>
                            </div>
                            <div class="editable-grid">
                                <label>
                                    <span>{{ t("昵称", "Name") }}</span>
                                    <input v-model="account.name" />
                                </label>
                                <label class="checkbox-row">
                                    <input v-model="account.isAdmin" type="checkbox" :disabled="account.id === user?.id" />
                                    <span>{{ t("管理员", "Admin") }}</span>
                                </label>
                                <label>
                                    <span>{{ t("帖子数", "Topics") }}</span>
                                    <input :value="account.topicCount" disabled />
                                </label>
                            </div>
                            <div class="row-actions">
                                <button class="icon-button" type="submit" :title="t('保存', 'Save')">
                                    <Icon name="lucide:save" />
                                </button>
                                <button
                                    class="icon-button"
                                    type="button"
                                    :disabled="account.id === user?.id"
                                    :title="t('删除账号', 'Delete account')"
                                    @click="deleteAccount(account.id)"
                                >
                                    <Icon name="lucide:user-x" />
                                </button>
                            </div>
                        </form>
                    </div>
                </section>

                <section id="topics" class="admin-section surface-panel">
                    <div class="admin-section__head">
                        <div>
                            <p class="eyebrow">{{ t("帖子", "Topics") }}</p>
                            <h2>{{ t("帖子与回复管理", "Topic and reply moderation") }}</h2>
                            <p>
                                {{
                                    t(
                                        "可以直接编辑帖子内容、归属板块、浏览数和点赞数；真实评论在下方评论管理里处理。",
                                        "Edit topic content, board ownership, views, and likes here. Real comments are managed in the comment moderation section below."
                                    )
                                }}
                            </p>
                        </div>
                        <div class="filter-row">
                            <label class="inline-filter">
                                <span>{{ t("板块", "Board") }}</span>
                                <select v-model="topicBoardFilter">
                                    <option value="">{{ t("全部", "All") }}</option>
                                    <option v-for="board in boards" :key="board.key" :value="board.key">
                                        {{ locale === "zh" ? board.name_zh : board.name_en }}
                                    </option>
                                </select>
                            </label>
                            <label class="inline-filter">
                                <span>{{ t("搜索", "Search") }}</span>
                                <input v-model="topicQuery" :placeholder="t('标题、作者、正文', 'Title, author, or body')" />
                            </label>
                        </div>
                    </div>

                    <div class="editable-list">
                        <article v-for="topic in filteredTopics" :key="topic.id" class="editable-card">
                            <div class="editable-card__head">
                                <div>
                                    <p class="eyebrow">{{ topic.boardName }}</p>
                                    <strong>{{ locale === "zh" ? topic.titleZh : topic.titleEn }}</strong>
                                </div>
                                <div class="row-actions">
                                    <button class="icon-button" type="button" :title="t('删除', 'Delete')" @click="deleteTopic(topic.id)">
                                        <Icon name="lucide:trash-2" />
                                    </button>
                                    <button class="icon-button" type="button" :title="t('保存', 'Save')" @click="saveTopic(topic)">
                                        <Icon name="lucide:save" />
                                    </button>
                                </div>
                            </div>

                            <p class="editable-card__copy">
                                {{ locale === "zh" ? topic.bodyZh : topic.bodyEn }}
                            </p>

                            <div class="topic-meta">
                                <span>{{ topic.authorName }}</span>
                                <span>{{ topic.authorEmail || t("无邮箱", "No email") }}</span>
                                <span>{{ formatDate(topic.createdAt) }}</span>
                            </div>

                            <div class="editable-grid">
                                <label>
                                    <span>{{ t("板块", "Board") }}</span>
                                    <select v-model="topic.boardKey">
                                        <option v-for="board in boards" :key="board.key" :value="board.key">
                                            {{ locale === "zh" ? board.name_zh : board.name_en }}
                                        </option>
                                    </select>
                                </label>
                                <label>
                                    <span>{{ t("作者", "Author") }}</span>
                                    <input v-model="topic.authorName" />
                                </label>
                                <label>
                                    <span>{{ t("中文标题", "Chinese title") }}</span>
                                    <input v-model="topic.titleZh" />
                                </label>
                                <label>
                                    <span>{{ t("English title", "English title") }}</span>
                                    <input v-model="topic.titleEn" />
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("中文正文", "Chinese body") }}</span>
                                    <textarea v-model="topic.bodyZh"></textarea>
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("English body", "English body") }}</span>
                                    <textarea v-model="topic.bodyEn"></textarea>
                                </label>
                                <label>
                                    <span>{{ t("回复 / 评论数", "Replies / comments") }}</span>
                                    <input v-model.number="topic.replies" min="0" type="number" />
                                </label>
                                <label>
                                    <span>{{ t("浏览数", "Views") }}</span>
                                    <input v-model.number="topic.views" min="0" type="number" />
                                </label>
                                <label>
                                    <span>{{ t("点赞数", "Likes") }}</span>
                                    <input v-model.number="topic.likes" min="0" type="number" />
                                </label>
                            </div>
                        </article>
                    </div>
                </section>

                <section id="comments" class="admin-section surface-panel">
                    <div class="admin-section__head">
                        <div>
                            <p class="eyebrow">{{ t("评论", "Comments") }}</p>
                            <h2>{{ t("评论管理", "Comment moderation") }}</h2>
                            <p>{{ t("真实评论数据会列在这里，可以修改归属帖子、作者和双语内容。", "Real comment records appear here. You can edit topic ownership, author, and bilingual content.") }}</p>
                        </div>
                        <label class="inline-filter">
                            <span>{{ t("搜索", "Search") }}</span>
                            <input v-model="commentQuery" :placeholder="t('帖子、作者、内容', 'Topic, author, or body')" />
                        </label>
                    </div>

                    <div class="editable-list">
                        <article v-for="comment in filteredComments" :key="comment.id" class="editable-card">
                            <div class="editable-card__head">
                                <div>
                                    <p class="eyebrow">{{ comment.boardName }}</p>
                                    <strong>{{ locale === "zh" ? comment.topicTitleZh : comment.topicTitleEn }}</strong>
                                </div>
                                <div class="row-actions">
                                    <button class="icon-button" type="button" :title="t('删除', 'Delete')" @click="deleteComment(comment.id)">
                                        <Icon name="lucide:trash-2" />
                                    </button>
                                    <button class="icon-button" type="button" :title="t('保存', 'Save')" @click="saveComment(comment)">
                                        <Icon name="lucide:save" />
                                    </button>
                                </div>
                            </div>

                            <p class="editable-card__copy">
                                {{ locale === "zh" ? comment.bodyZh : comment.bodyEn }}
                            </p>

                            <div class="topic-meta">
                                <span>{{ comment.authorName }}</span>
                                <span>{{ comment.authorEmail || t("无邮箱", "No email") }}</span>
                                <span>{{ formatDate(comment.createdAt) }}</span>
                            </div>

                            <div class="editable-grid">
                                <label>
                                    <span>{{ t("所属帖子", "Topic") }}</span>
                                    <select v-model.number="comment.topicId">
                                        <option v-for="topic in topicForms" :key="topic.id" :value="topic.id">
                                            {{ locale === "zh" ? topic.titleZh : topic.titleEn }}
                                        </option>
                                    </select>
                                </label>
                                <label>
                                    <span>{{ t("作者", "Author") }}</span>
                                    <input v-model="comment.authorName" />
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("中文内容", "Chinese body") }}</span>
                                    <textarea v-model="comment.bodyZh"></textarea>
                                </label>
                                <label class="editable-grid__wide">
                                    <span>{{ t("English body", "English body") }}</span>
                                    <textarea v-model="comment.bodyEn"></textarea>
                                </label>
                            </div>
                        </article>
                    </div>
                </section>
            </section>

            <section v-else class="admin-denied surface-panel">
                <Icon name="lucide:shield-alert" />
                <strong>{{ t("需要管理员权限", "Admin access required") }}</strong>
                <NuxtLink class="button button--primary" :to="`/${locale}/auth/login`">
                    {{ content.auth.login }}
                </NuxtLink>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
import type { AdminComment, AdminTopic, AdminUser, Announcement, Board, SiteSettings } from "~/types/api";

type SectionId = "overview" | "settings" | "announcements" | "boards" | "users" | "topics" | "comments";

type BoardForm = {
    descriptionEn: string;
    descriptionZh: string;
    id: number;
    key: string;
    nameEn: string;
    nameZh: string;
    topicCount: number;
};

type AnnouncementForm = {
    bodyEn: string;
    bodyZh: string;
    createdAt: string;
    id: number;
    isPinned: boolean;
    tagEn: string;
    tagZh: string;
    titleEn: string;
    titleZh: string;
};

type TopicForm = {
    authorAvatarUrl: string | null;
    authorEmail: string | null;
    authorName: string;
    boardDescriptionEn: string | null;
    boardDescriptionZh: string | null;
    boardKey: string;
    boardName: string;
    bodyEn: string;
    bodyZh: string;
    createdAt: string;
    likes: number;
    replies: number;
    titleEn: string;
    titleZh: string;
    views: number;
};

type CommentForm = {
    authorEmail: string | null;
    authorName: string;
    boardName: string;
    bodyEn: string;
    bodyZh: string;
    createdAt: string;
    id: number;
    topicId: number;
    topicTitleEn: string;
    topicTitleZh: string;
};

const { alternateLocale, content, locale } = useSiteLocale();
const { refreshUser, user } = useAuth();

if (!user.value) {
    await refreshUser();
}

const sidebarOpen = ref(false);
const activeSection = ref<SectionId>("overview");
const statusMessage = ref("");
const userQuery = ref("");
const topicQuery = ref("");
const topicBoardFilter = ref("");
const commentQuery = ref("");
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
const announcementForms = ref<AnnouncementForm[]>([]);
const userForms = ref<AdminUser[]>([]);
const topicForms = ref<TopicForm[]>([]);
const commentForms = ref<CommentForm[]>([]);
const { data: settingsData, refresh: refreshSettings } = await useFetch<{ announcements: Announcement[]; settings: SiteSettings }>(
    "/api/admin/settings",
    {
        immediate: false,
    },
);
const { data: boardsData, refresh: refreshBoards } = await useFetch<{ boards: Array<Board & { topic_count: number }> }>(
    "/api/admin/boards",
    {
        immediate: false,
    },
);
const { data: usersData, refresh: refreshUsers } = await useFetch<{ users: AdminUser[] }>("/api/admin/users", {
    immediate: false,
});
const { data: topicsData, refresh: refreshTopics } = await useFetch<{ topics: AdminTopic[] }>("/api/admin/topics", {
    immediate: false,
});
const { data: commentsData, refresh: refreshComments } = await useFetch<{ comments: AdminComment[] }>("/api/admin/comments", {
    immediate: false,
});
const boards = computed(() => boardsData.value?.boards ?? []);

if (user.value?.isAdmin) {
    await refreshAll();
}

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
    announcementForms.value =
        settingsData.value?.announcements.map((announcement) => ({
            bodyEn: announcement.body_en,
            bodyZh: announcement.body_zh,
            createdAt: announcement.created_at,
            id: announcement.id,
            isPinned: announcement.is_pinned === 1,
            tagEn: announcement.tag_en,
            tagZh: announcement.tag_zh,
            titleEn: announcement.title_en,
            titleZh: announcement.title_zh,
        })) ?? [];
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

watchEffect(() => {
    topicForms.value =
        topicsData.value?.topics.map((topic) => ({
            authorAvatarUrl: topic.author_avatar_url,
            authorEmail: topic.author_email,
            authorName: topic.author_name,
            boardDescriptionEn: topic.board_description_en,
            boardDescriptionZh: topic.board_description_zh,
            boardKey: topic.board_key || "",
            boardName:
                locale.value === "zh"
                    ? topic.board_name_zh || t("未分区", "Unassigned")
                    : topic.board_name_en || t("未分区", "Unassigned"),
            bodyEn: topic.body_en,
            bodyZh: topic.body_zh,
            createdAt: topic.created_at,
            id: topic.id,
            likes: topic.likes,
            replies: topic.replies,
            titleEn: topic.title_en,
            titleZh: topic.title_zh,
            views: topic.views,
        })) ?? [];
});

watchEffect(() => {
    commentForms.value =
        commentsData.value?.comments.map((comment) => ({
            authorEmail: comment.author_email,
            authorName: comment.author_name,
            boardName:
                locale.value === "zh"
                    ? comment.board_name_zh || t("未分区", "Unassigned")
                    : comment.board_name_en || t("未分区", "Unassigned"),
            bodyEn: comment.body_en,
            bodyZh: comment.body_zh,
            createdAt: comment.created_at,
            id: comment.id,
            topicId: comment.topic_id,
            topicTitleEn: comment.topic_title_en,
            topicTitleZh: comment.topic_title_zh,
        })) ?? [];
});

watch(
    () => user.value?.isAdmin,
    (isAdmin) => {
        if (!isAdmin) {
            return;
        }

        void refreshAll();
    },
);

const filteredUsers = computed(() => {
    const query = userQuery.value.trim().toLowerCase();

    if (!query) {
        return userForms.value;
    }

    return userForms.value.filter((account) => {
        return [account.email, account.name].some((value) => value.toLowerCase().includes(query));
    });
});

const filteredTopics = computed(() => {
    const query = topicQuery.value.trim().toLowerCase();

    return topicForms.value.filter((topic) => {
        const matchesBoard = !topicBoardFilter.value || topic.boardKey === topicBoardFilter.value;
        const matchesQuery =
            !query ||
            [topic.authorName, topic.authorEmail || "", topic.titleZh, topic.titleEn, topic.bodyZh, topic.bodyEn, topic.boardName]
                .join(" ")
                .toLowerCase()
                .includes(query);

        return matchesBoard && matchesQuery;
    });
});

const filteredComments = computed(() => {
    const query = commentQuery.value.trim().toLowerCase();

    if (!query) {
        return commentForms.value;
    }

    return commentForms.value.filter((comment) => {
        return [comment.authorName, comment.authorEmail || "", comment.topicTitleZh, comment.topicTitleEn, comment.bodyZh, comment.bodyEn, comment.boardName]
            .join(" ")
            .toLowerCase()
            .includes(query);
    });
});

const summaryCards = computed(() => [
    {
        label: t("用户", "Users"),
        value: String(userForms.value.length),
    },
    {
        label: t("帖子", "Topics"),
        value: String(topicForms.value.length),
    },
    {
        label: t("公告", "Announcements"),
        value: String(announcementForms.value.length),
    },
    {
        label: t("评论", "Comments"),
        value: String(commentForms.value.length),
    },
    {
        label: t("板块", "Boards"),
        value: String(boardForms.value.length),
    },
]);

const overviewMetrics = computed(() => [
    {
        label: t("总用户", "Total users"),
        note: t("当前可管理账号", "Accounts you can manage"),
        value: String(userForms.value.length),
    },
    {
        label: t("总帖子", "Total topics"),
        note: t("包括全部板块", "Across every board"),
        value: String(topicForms.value.length),
    },
    {
        label: t("总回复", "Total replies"),
        note: t("真实评论记录", "Real comment records"),
        value: String(commentForms.value.length),
    },
    {
        label: t("总点赞", "Total likes"),
        note: t("内容热度指标", "Engagement signal"),
        value: String(topicForms.value.reduce((sum, item) => sum + Number(item.likes || 0), 0)),
    },
]);

const navItems = computed(() => [
    {
        count: String(overviewMetrics.value.length),
        id: "overview" as const,
        icon: "lucide:layout-dashboard",
        label: t("概览", "Overview"),
    },
    {
        count: String(1),
        id: "settings" as const,
        icon: "lucide:settings-2",
        label: t("站点", "Site"),
    },
    {
        count: String(announcementForms.value.length),
        id: "announcements" as const,
        icon: "lucide:megaphone",
        label: t("公告", "Announcements"),
    },
    {
        count: String(boardForms.value.length),
        id: "boards" as const,
        icon: "lucide:blocks",
        label: t("板块", "Boards"),
    },
    {
        count: String(userForms.value.length),
        id: "users" as const,
        icon: "lucide:users",
        label: t("用户", "Users"),
    },
    {
        count: String(topicForms.value.length),
        id: "topics" as const,
        icon: "lucide:file-text",
        label: t("帖子", "Topics"),
    },
    {
        count: String(commentForms.value.length),
        id: "comments" as const,
        icon: "lucide:message-square",
        label: t("评论", "Comments"),
    },
]);

function t(zh: string, en: string): string {
    return locale.value === "zh" ? zh : en;
}

function jumpTo(section: SectionId): void {
    activeSection.value = section;
    sidebarOpen.value = false;
    document.getElementById(section)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
    });
}

async function refreshAll(): Promise<void> {
    await Promise.all([refreshSettings(), refreshBoards(), refreshUsers(), refreshTopics(), refreshComments()]);
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
        body: {
            action: "create",
            ...announcementForm,
        },
        method: "POST",
    });
    announcementForm.bodyEn = "";
    announcementForm.bodyZh = "";
    announcementForm.titleEn = "";
    announcementForm.titleZh = "";
    markSaved();
    await refreshSettings();
}

async function saveAnnouncement(announcement: AnnouncementForm): Promise<void> {
    await $fetch("/api/admin/announcements", {
        body: {
            action: "update",
            bodyEn: announcement.bodyEn,
            bodyZh: announcement.bodyZh,
            id: announcement.id,
            isPinned: announcement.isPinned,
            tagEn: announcement.tagEn,
            tagZh: announcement.tagZh,
            titleEn: announcement.titleEn,
            titleZh: announcement.titleZh,
        },
        method: "POST",
    });
    await refreshSettings();
    markSaved();
}

async function deleteAnnouncement(id: number): Promise<void> {
    await $fetch("/api/admin/announcements", {
        body: {
            action: "delete",
            id,
        },
        method: "POST",
    });
    await refreshSettings();
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

async function updateAccount(account: AdminUser): Promise<void> {
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

async function saveTopic(topic: TopicForm): Promise<void> {
    await $fetch("/api/admin/topics", {
        body: {
            action: "update",
            authorName: topic.authorName,
            bodyEn: topic.bodyEn,
            bodyZh: topic.bodyZh,
            boardKey: topic.boardKey,
            id: topic.id,
            likes: topic.likes,
            replies: topic.replies,
            titleEn: topic.titleEn,
            titleZh: topic.titleZh,
            views: topic.views,
        },
        method: "POST",
    });
    await Promise.all([refreshTopics(), refreshComments()]);
    markSaved();
}

async function deleteTopic(id: number): Promise<void> {
    await $fetch("/api/admin/topics", {
        body: {
            action: "delete",
            id,
        },
        method: "POST",
    });
    await Promise.all([refreshTopics(), refreshComments()]);
    markSaved();
}

async function saveComment(comment: CommentForm): Promise<void> {
    await $fetch("/api/admin/comments", {
        body: {
            action: "update",
            authorName: comment.authorName,
            bodyEn: comment.bodyEn,
            bodyZh: comment.bodyZh,
            id: comment.id,
            topicId: comment.topicId,
        },
        method: "POST",
    });
    await refreshComments();
    markSaved();
}

async function deleteComment(id: number): Promise<void> {
    await $fetch("/api/admin/comments", {
        body: {
            action: "delete",
            id,
        },
        method: "POST",
    });
    await refreshComments();
    markSaved();
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en", {
        dateStyle: "medium",
    }).format(new Date(value));
}

function markSaved(): void {
    statusMessage.value = t("已保存", "Saved");
    window.setTimeout(() => {
        statusMessage.value = "";
    }, 1800);
}

useSeoMeta({
    title: "Admin",
});

useHead({
    htmlAttrs: {
        lang: () => (locale.value === "zh" ? "zh-CN" : "en"),
    },
});
</script>

<style scoped>
.admin-app {
    display: grid;
    gap: 20px;
    grid-template-columns: minmax(280px, 320px) minmax(0, 1fr);
    margin: 0 auto;
    max-width: 1440px;
    padding: 18px 24px 88px;
    position: relative;
}

.admin-drawer-toggle {
    display: none;
}

.admin-drawer {
    align-self: start;
    display: grid;
    gap: 22px;
    padding: 20px;
    position: sticky;
    top: 16px;
}

.admin-drawer__head h1,
.admin-section__head h2 {
    font-family: var(--font-display);
    font-size: 1.9rem;
    line-height: 1.02;
    margin: 0;
}

.admin-drawer__head p,
.admin-section__head p {
    color: var(--color-muted);
    margin: 12px 0 0;
}

.admin-summary {
    display: grid;
    gap: 10px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.admin-summary__item {
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    display: grid;
    gap: 4px;
    padding: 12px;
}

.admin-summary__item span,
.admin-summary__item strong,
.admin-summary__item small,
.admin-drawer__foot span,
.admin-drawer__foot small {
    min-width: 0;
    overflow-wrap: anywhere;
}

.admin-summary__item span,
.admin-drawer__foot span {
    color: var(--color-muted);
    font-size: 0.78rem;
    font-weight: 900;
}

.admin-summary__item strong {
    font-size: 1.3rem;
}

.admin-nav {
    display: grid;
    gap: 8px;
}

.admin-nav button {
    align-items: center;
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    border: 1px solid transparent;
    border-radius: 8px;
    color: var(--color-text);
    cursor: pointer;
    display: grid;
    gap: 10px;
    grid-template-columns: auto minmax(0, 1fr) auto;
    padding: 12px 14px;
    text-align: left;
    transition:
        border-color 180ms ease,
        background 180ms ease,
        transform 180ms ease;
}

.admin-nav button:hover,
.admin-nav button.is-active {
    background: color-mix(in srgb, var(--color-surface) 86%, var(--color-orchid) 14%);
    border-color: color-mix(in srgb, var(--color-orchid) 34%, var(--color-line));
}

.admin-nav button svg {
    font-size: 1rem;
}

.admin-nav button span {
    font-weight: 900;
}

.admin-nav button small {
    color: var(--color-muted);
    font-weight: 900;
}

.admin-drawer__foot {
    border-top: 1px solid var(--color-line);
    display: grid;
    gap: 6px;
    padding-top: 16px;
}

.admin-content {
    display: grid;
    gap: 18px;
}

.admin-section {
    display: grid;
    gap: 18px;
    padding: 22px;
}

.admin-section__head {
    align-items: end;
    display: flex;
    gap: 16px;
    justify-content: space-between;
}

.admin-section__head > div {
    max-width: 820px;
}

.metric-grid {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(4, minmax(0, 1fr));
}

.metric-card {
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    display: grid;
    gap: 4px;
    padding: 16px;
}

.metric-card span,
.metric-card small {
    color: var(--color-muted);
    font-weight: 900;
}

.metric-card strong {
    font-size: 1.8rem;
    line-height: 1;
}

.admin-form {
    display: grid;
    gap: 14px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.admin-form--compact {
    align-items: start;
}

.admin-form label,
.editable-grid label,
.inline-filter {
    display: grid;
    gap: 8px;
}

.admin-form label span,
.editable-grid label span,
.inline-filter span {
    color: var(--color-muted);
    font-weight: 900;
}

.admin-form__actions {
    grid-column: 1 / -1;
}

.admin-form__actions .button {
    justify-self: start;
}

.editable-list {
    display: grid;
    gap: 14px;
}

.editable-card,
.editable-row {
    background: color-mix(in srgb, var(--color-surface) 92%, transparent);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    display: grid;
    gap: 14px;
    padding: 16px;
}

.editable-card__head,
.editable-row__meta {
    align-items: start;
    display: flex;
    gap: 14px;
    justify-content: space-between;
}

.editable-card__head strong,
.editable-row__meta strong {
    display: block;
    line-height: 1.2;
}

.editable-card__copy {
    color: var(--color-muted);
    margin: 0;
}

.editable-grid {
    display: grid;
    gap: 12px;
    grid-template-columns: repeat(2, minmax(0, 1fr));
}

.editable-grid__wide {
    grid-column: 1 / -1;
}

.editable-grid input,
.editable-grid select,
.editable-grid textarea,
.admin-form input,
.admin-form select,
.admin-form textarea {
    min-width: 0;
}

.topic-meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px 14px;
}

.topic-meta span {
    color: var(--color-muted);
    font-size: 0.88rem;
    font-weight: 900;
}

.board-create {
    display: grid;
    gap: 10px;
    grid-template-columns: 0.85fr repeat(4, minmax(0, 1fr)) auto;
}

.editable-row--user {
    grid-template-columns: minmax(0, 1fr);
}

.inline-filter,
.filter-row {
    display: grid;
    gap: 10px;
}

.filter-row {
    grid-template-columns: repeat(2, minmax(220px, 1fr));
}

.row-actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}

.icon-button {
    align-items: center;
    background: color-mix(in srgb, var(--color-surface) 82%, var(--color-bg) 18%);
    border-radius: 8px;
    color: var(--color-text);
    cursor: pointer;
    display: inline-flex;
    height: 40px;
    justify-content: center;
    width: 40px;
}

.icon-button:disabled {
    cursor: not-allowed;
    opacity: 0.45;
}

.checkbox-row {
    align-items: center;
    display: flex;
    gap: 8px;
}

.checkbox-row input {
    min-height: auto;
    width: auto;
}

.admin-denied {
    align-items: center;
    display: grid;
    gap: 18px;
    justify-items: center;
    margin: 0 auto;
    max-width: 560px;
    min-height: 42vh;
    padding: 38px;
    text-align: center;
}

.admin-denied svg {
    color: var(--color-cedar);
    font-size: 2rem;
}

@media (max-width: 1180px) {
    .admin-app {
        grid-template-columns: minmax(0, 1fr);
    }

    .admin-drawer-toggle {
        display: inline-flex;
        justify-self: start;
    }

    .admin-drawer {
        bottom: 16px;
        left: 16px;
        max-height: calc(100vh - 32px);
        overflow: auto;
        position: fixed;
        top: 16px;
        transform: translateX(calc(-100% - 24px));
        transition: transform 220ms ease;
        width: min(86vw, 320px);
        z-index: 30;
    }

    .admin-shell.is-sidebar-open .admin-drawer {
        transform: translateX(0);
    }

    .admin-drawer-backdrop {
        background: rgba(5, 8, 20, 0.42);
        inset: 0;
        opacity: 0;
        pointer-events: none;
        position: fixed;
        transition: opacity 220ms ease;
        z-index: 20;
    }

    .admin-shell.is-sidebar-open .admin-drawer-backdrop {
        opacity: 1;
        pointer-events: auto;
    }

    .metric-grid,
    .admin-form,
    .editable-grid,
    .board-create,
    .filter-row {
        grid-template-columns: 1fr;
    }

    .admin-section__head,
    .editable-card__head,
    .editable-row__meta {
        align-items: start;
        flex-direction: column;
    }
}

@media (max-width: 720px) {
    .admin-app {
        padding: 18px 18px 72px;
    }

    .admin-section,
    .admin-drawer {
        padding: 18px;
    }

    .row-actions {
        justify-content: flex-start;
    }

    .admin-drawer-toggle {
        width: 100%;
    }
}
</style>
