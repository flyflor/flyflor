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
                            ? "配置开发者社区主题、标题、副标题，并发布官方公告。"
                            : "Configure community theme, title, subtitle, and official announcements."
                    }}
                </p>
            </section>

            <section v-if="user?.isAdmin" class="admin-layout">
                <form class="surface-panel admin-card" @submit.prevent="saveSettings">
                    <h2>{{ locale === "zh" ? "主题配置" : "Theme settings" }}</h2>
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
import type { SiteSettings } from "~/types/api";

const { alternateLocale, content, locale } = useSiteLocale();
const { user } = useAuth();
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

const { data, refresh } = await useFetch<{ settings: SiteSettings }>("/api/admin/settings", {
    immediate: false,
});

watchEffect(() => {
    const settings = data.value?.settings;

    if (!settings) {
        return;
    }

    settingsForm.accentColor = settings.accent_color;
    settingsForm.communitySubtitleEn = settings.community_subtitle_en;
    settingsForm.communitySubtitleZh = settings.community_subtitle_zh;
    settingsForm.communityTitleEn = settings.community_title_en;
    settingsForm.communityTitleZh = settings.community_title_zh;
});

onMounted(() => {
    if (user.value?.isAdmin) {
        void refresh();
    }
});

async function saveSettings(): Promise<void> {
    await $fetch("/api/admin/settings", {
        body: settingsForm,
        method: "POST",
    });
    await refresh();
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

.admin-card {
    display: grid;
    gap: 14px;
    padding: 24px;
}

.admin-card h2 {
    margin: 0;
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

@media (max-width: 900px) {
    .admin-layout {
        grid-template-columns: 1fr;
    }
}
</style>
