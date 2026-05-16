<template>
    <div class="page-shell">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main>
            <section class="community-hero reveal-flip" :style="{ '--community-accent': settings?.accent_color }">
                <div>
                    <p class="eyebrow">Community</p>
                    <h1>{{ communityTitle }}</h1>
                    <p>{{ communitySubtitle }}</p>
                </div>
                <div class="community-hero__actions">
                    <NuxtLink v-if="user?.isAdmin" class="button button--secondary" :to="`/${locale}/admin`">
                        <Icon name="lucide:settings" />
                        {{ content.bbs.admin }}
                    </NuxtLink>
                    <NuxtLink v-if="!user" class="button button--primary" :to="`/${locale}/auth/login`">
                        <Icon name="lucide:log-in" />
                        {{ content.bbs.loginPrompt }}
                    </NuxtLink>
                </div>
            </section>

            <section class="community-layout reveal-flip">
                <aside class="side-column">
                    <section class="surface-panel side-panel reveal-flip">
                        <h2>{{ content.bbs.announcements }}</h2>
                        <article v-for="item in announcements" :key="item.id" class="announcement-item">
                            <span>{{ locale === "zh" ? item.tag_zh : item.tag_en }}</span>
                            <strong>{{ locale === "zh" ? item.title_zh : item.title_en }}</strong>
                            <p>{{ locale === "zh" ? item.body_zh : item.body_en }}</p>
                        </article>
                    </section>

                    <section class="surface-panel side-panel reveal-flip">
                        <h2>{{ content.bbs.leaderboard }}</h2>
                        <div v-for="member in leaderboard" :key="member.name" class="leader-item">
                            <span>{{ member.name.slice(0, 1).toUpperCase() }}</span>
                            <strong>{{ member.name }}</strong>
                            <small>{{ member.score }}</small>
                        </div>
                    </section>
                </aside>

                <div class="feed-column">
                    <form v-if="user" class="topic-form surface-panel reveal-flip" @submit.prevent="submitTopic">
                        <h2>{{ content.bbs.newTopic }}</h2>
                        <select v-model="topicBoardKey" required>
                            <option v-for="board in boards" :key="board.key" :value="board.key">
                                {{ locale === "zh" ? board.name_zh : board.name_en }}
                            </option>
                        </select>
                        <input v-model="topicTitle" :placeholder="content.bbs.titlePlaceholder" required />
                        <textarea v-model="topicBody" :placeholder="content.bbs.bodyPlaceholder" required></textarea>
                        <button class="button button--primary" type="submit">
                            <Icon name="lucide:send" />
                            {{ content.bbs.submit }}
                        </button>
                    </form>

                    <div v-if="boards.length" class="board-filter surface-panel reveal-flip">
                        <button :class="{ 'is-active': selectedBoardKey === '' }" type="button" @click="selectedBoardKey = ''">
                            {{ locale === "zh" ? "全部" : "All" }}
                        </button>
                        <button
                            v-for="board in boards"
                            :key="board.key"
                            :class="{ 'is-active': selectedBoardKey === board.key }"
                            type="button"
                            @click="selectedBoardKey = board.key"
                        >
                            {{ locale === "zh" ? board.name_zh : board.name_en }}
                        </button>
                    </div>

                    <article v-for="topic in filteredTopics" :key="topic.id" class="topic-card surface-panel reveal-flip">
                        <div class="topic-card__head">
                            <span>{{ topic.author_name }}</span>
                            <small>{{ boardName(topic.board_key) }}</small>
                            <small>{{ formatDate(topic.created_at) }}</small>
                        </div>
                        <h2>{{ locale === "zh" ? topic.title_zh : topic.title_en }}</h2>
                        <p>{{ locale === "zh" ? topic.body_zh : topic.body_en }}</p>
                        <footer>
                            <span>
                                <Icon name="lucide:eye" />
                                {{ topic.views }} {{ content.bbs.views }}
                            </span>
                            <span>
                                <Icon name="lucide:message-square" />
                                {{ topic.replies }} {{ content.bbs.replies }}
                            </span>
                            <span>
                                <Icon name="lucide:thumbs-up" />
                                {{ topic.likes }}
                            </span>
                        </footer>
                    </article>
                </div>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
import type { Announcement, Board, SiteSettings, Topic } from "~/types/api";

const { alternateLocale, content, locale } = useSiteLocale();
const { user } = useAuth();
const selectedBoardKey = ref("");
const topicBoardKey = ref("");
const topicTitle = ref("");
const topicBody = ref("");
const { data, refresh } = await useFetch<{
    announcements: Announcement[];
    boards: Board[];
    settings: SiteSettings;
    topics: Topic[];
}>("/api/bbs");
const announcements = computed(() => data.value?.announcements ?? []);
const boards = computed(() => data.value?.boards ?? []);
const settings = computed(() => data.value?.settings ?? null);
const topics = computed(() => data.value?.topics ?? []);
const filteredTopics = computed(() => {
    if (!selectedBoardKey.value) {
        return topics.value;
    }

    return topics.value.filter((topic) => topic.board_key === selectedBoardKey.value);
});
const communityTitle = computed(() => {
    if (!settings.value) {
        return content.value.bbs.title;
    }

    return locale.value === "zh" ? settings.value.community_title_zh : settings.value.community_title_en;
});
const communitySubtitle = computed(() => {
    if (!settings.value) {
        return content.value.bbs.body;
    }

    return locale.value === "zh" ? settings.value.community_subtitle_zh : settings.value.community_subtitle_en;
});
const leaderboard = computed(() => {
    const scores = new Map<string, number>();

    for (const topic of topics.value) {
        scores.set(topic.author_name, (scores.get(topic.author_name) ?? 0) + topic.replies + topic.likes + 1);
    }

    return [...scores.entries()]
        .map(([name, score]) => ({
            name,
            score,
        }))
        .sort((left, right) => right.score - left.score)
        .slice(0, 5);
});

watchEffect(() => {
    if (!topicBoardKey.value && boards.value[0]) {
        topicBoardKey.value = boards.value[0].key;
    }
});

function boardName(key: string | null): string {
    const board = boards.value.find((item) => item.key === key);

    if (!board) {
        return locale.value === "zh" ? "未分区" : "Unassigned";
    }

    return locale.value === "zh" ? board.name_zh : board.name_en;
}

function formatDate(value: string): string {
    return new Intl.DateTimeFormat(locale.value === "zh" ? "zh-CN" : "en", {
        dateStyle: "medium",
    }).format(new Date(value));
}

async function submitTopic(): Promise<void> {
    await $fetch("/api/bbs/topics", {
        body: {
            boardKey: topicBoardKey.value,
            body: topicBody.value,
            title: topicTitle.value,
        },
        method: "POST",
    });

    topicBody.value = "";
    topicTitle.value = "";
    await refresh();
}

useSeoMeta({
    description: () => content.value.bbs.body,
    title: "Community",
});

useHead({
    htmlAttrs: {
        lang: () => (locale.value === "zh" ? "zh-CN" : "en"),
    },
});
</script>

<style scoped>
.community-hero {
    align-items: end;
    display: grid;
    gap: 24px;
    grid-template-columns: minmax(0, 1fr) auto;
    margin: 0 auto;
    max-width: 1160px;
    padding: 54px 24px 28px;
}

.community-hero h1 {
    color: var(--community-accent, var(--color-text));
    font-family: var(--font-display);
    font-size: clamp(3rem, 8vw, 6rem);
    font-weight: 900;
    letter-spacing: 0;
    line-height: 0.95;
    margin: 0;
}

.community-hero p:not(.eyebrow) {
    color: var(--color-muted);
    font-size: 1.18rem;
    margin: 22px 0 0;
    max-width: 780px;
}

.community-hero__actions {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.community-layout {
    align-items: start;
    display: grid;
    gap: 24px;
    grid-template-columns: 320px minmax(0, 1fr);
    margin: 0 auto;
    max-width: 1160px;
    padding: 24px 24px 88px;
}

.side-column,
.feed-column {
    display: grid;
    gap: 16px;
}

.side-panel {
    display: grid;
    gap: 14px;
    padding: 20px;
}

.side-panel h2 {
    font-size: 1rem;
    margin: 0;
}

.announcement-item {
    border-top: 1px solid var(--color-line);
    display: grid;
    gap: 6px;
    padding-top: 14px;
}

.announcement-item span {
    color: var(--color-cedar);
    font-size: 0.78rem;
    font-weight: 900;
}

.announcement-item strong,
.announcement-item p {
    margin: 0;
}

.announcement-item p {
    color: var(--color-muted);
}

.leader-item {
    align-items: center;
    border-top: 1px solid var(--color-line);
    display: grid;
    gap: 10px;
    grid-template-columns: 34px minmax(0, 1fr) auto;
    padding-top: 12px;
}

.leader-item span {
    align-items: center;
    background: var(--color-surface-soft);
    border-radius: 999px;
    display: inline-flex;
    font-weight: 900;
    height: 34px;
    justify-content: center;
    width: 34px;
}

.leader-item small {
    color: var(--color-muted);
    font-weight: 900;
}

.topic-form {
    display: grid;
    gap: 12px;
    padding: 22px;
}

.topic-form h2 {
    margin: 0;
}

.topic-form .button {
    width: fit-content;
}

.board-filter {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 12px;
}

.board-filter button {
    background: transparent;
    border-radius: 6px;
    color: var(--color-muted);
    cursor: pointer;
    font-weight: 900;
    min-height: 36px;
    padding: 0 12px;
}

.board-filter button.is-active {
    background: var(--color-text);
    color: var(--color-surface);
}

.topic-card {
    display: grid;
    gap: 14px;
    padding: 24px;
}

.topic-card__head,
.topic-card footer {
    align-items: center;
    color: var(--color-muted);
    display: flex;
    flex-wrap: wrap;
    gap: 14px;
}

.topic-card__head span {
    color: var(--color-text);
    font-weight: 900;
}

.topic-card h2,
.topic-card p {
    margin: 0;
}

.topic-card p {
    color: var(--color-muted);
}

.topic-card footer {
    border-top: 1px solid var(--color-line);
    padding-top: 14px;
}

.topic-card footer span {
    align-items: center;
    display: inline-flex;
    gap: 6px;
}

@media (max-width: 900px) {
    .community-hero,
    .community-layout {
        grid-template-columns: 1fr;
    }
}
</style>
