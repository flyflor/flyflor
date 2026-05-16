<template>
    <header class="site-header">
        <NuxtLink class="brand" :to="`/${content.locale}`">
            <span class="brand__mark">
                <img src="/brand/flyflor.logo.transparent.png" alt="" />
            </span>
            <span>Flyflor</span>
        </NuxtLink>

        <nav class="nav" aria-label="Main">
            <NuxtLink v-for="item in content.nav" :key="item.href" :to="item.href">
                {{ item.label }}
            </NuxtLink>
        </nav>

        <div class="actions">
            <div class="theme-switcher" :aria-label="content.theme.label">
                <button
                    v-for="item in themeItems"
                    :key="item.value"
                    :class="{ 'is-active': preference === item.value }"
                    type="button"
                    :title="item.label"
                    @click="setTheme(item.value)"
                >
                    <Icon :name="item.icon" />
                </button>
            </div>
            <NuxtLink class="language-link" :to="`/${alternateLocale}`">
                {{ content.alternateLabel }}
            </NuxtLink>
            <button v-if="user" class="account-chip" type="button" @click="logout">
                {{ user.name }}
            </button>
            <NuxtLink v-else class="account-chip" :to="`/${content.locale}/auth/login`">
                {{ content.auth.login }}
            </NuxtLink>
            <a class="source-link" :href="content.repoUrl" rel="noreferrer" target="_blank">
                GitHub
            </a>
        </div>
    </header>
</template>

<script setup lang="ts">
import type { LocaleCode, SiteContent } from "~/data/site.content";
import type { ThemePreference } from "~/composables/use.theme";

const props = defineProps<{
    alternateLocale: LocaleCode;
    content: SiteContent;
}>();

const { logout, user } = useAuth();
const { preference, setTheme } = useTheme();
const themeItems = computed<Array<{ icon: string; label: string; value: ThemePreference }>>(() => [
    {
        icon: "lucide:sun",
        label: props.content.theme.light,
        value: "light",
    },
    {
        icon: "lucide:moon",
        label: props.content.theme.dark,
        value: "dark",
    },
    {
        icon: "lucide:monitor",
        label: props.content.theme.system,
        value: "system",
    },
]);
</script>

<style scoped>
.site-header {
    align-items: center;
    display: grid;
    gap: 16px;
    grid-template-columns: auto 1fr auto;
    margin: 0 auto;
    max-width: 1180px;
    padding: 22px 24px;
    width: 100%;
}

.brand,
.actions,
.nav {
    align-items: center;
    display: flex;
}

.brand {
    font-weight: 900;
    gap: 10px;
}

.brand__mark {
    align-items: center;
    background: #090b16;
    border-radius: 8px;
    box-shadow: 0 10px 28px color-mix(in srgb, var(--color-orchid) 22%, transparent);
    display: inline-flex;
    height: 34px;
    justify-content: center;
    overflow: hidden;
    width: 34px;
}

.brand__mark img {
    display: block;
    height: 100%;
    width: 100%;
}

.nav {
    color: var(--color-muted);
    gap: 24px;
    justify-content: center;
}

.actions {
    gap: 10px;
}

.theme-switcher {
    align-items: center;
    background: color-mix(in srgb, var(--color-surface) 78%, transparent);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    display: flex;
    padding: 3px;
}

.theme-switcher button {
    align-items: center;
    background: transparent;
    border: 0;
    border-radius: 6px;
    color: var(--color-muted);
    cursor: pointer;
    display: inline-flex;
    height: 32px;
    justify-content: center;
    width: 32px;
}

.theme-switcher button.is-active {
    background: var(--color-text);
    color: var(--color-surface);
}

.account-chip,
.language-link,
.source-link {
    border: 1px solid var(--color-line);
    border-radius: 8px;
    cursor: pointer;
    font-weight: 800;
    padding: 9px 12px;
}

.account-chip {
    background: var(--color-surface);
    color: var(--color-text);
    max-width: 140px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.source-link {
    background: var(--color-text);
    color: var(--color-surface);
}

@media (max-width: 820px) {
    .site-header {
        grid-template-columns: 1fr;
        padding: 18px;
    }

    .nav {
        justify-content: flex-start;
        overflow-x: auto;
    }
}
</style>
