<template>
    <div class="page-shell">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main>
            <section class="page-hero reveal-flip">
                <p class="eyebrow">Market</p>
                <h1>{{ content.market.title }}</h1>
                <p>{{ content.market.body }}</p>
            </section>

            <section class="market-section reveal-flip">
                <div class="market-tabs" role="tablist">
                    <button
                        v-for="tab in tabs"
                        :key="tab.value"
                        :class="{ 'is-active': selectedKind === tab.value }"
                        type="button"
                        @click="selectedKind = tab.value"
                    >
                        {{ tab.label }}
                    </button>
                </div>

                <div class="market-grid">
                    <article v-for="item in filteredItems" :key="item.slug" class="market-card surface-panel reveal-flip">
                        <div class="market-card__top">
                            <span>{{ item.kind === "skill" ? content.market.skill : content.market.mcp }}</span>
                            <strong>{{ item.name }}</strong>
                        </div>
                        <div v-if="ecosystemLabel(item)" class="market-card__ecosystem">
                            {{ ecosystemLabel(item) }}
                        </div>
                        <p>{{ locale === "zh" ? item.summary_zh : item.summary_en }}</p>
                        <p class="market-card__description">
                            {{ locale === "zh" ? item.description_zh : item.description_en }}
                        </p>
                        <div class="market-card__meta">
                            <span>
                                <Icon name="lucide:star" />
                                {{ item.stars }} {{ content.market.stars }}
                            </span>
                            <span>
                                <Icon name="lucide:download" />
                                {{ item.downloads }} {{ content.market.downloads }}
                            </span>
                        </div>
                        <div class="market-card__install">
                            <span>{{ content.market.install }}</span>
                            <code>{{ item.install_command }}</code>
                        </div>
                        <a class="button button--secondary" :href="item.repo_url" rel="noreferrer" target="_blank">
                            <Icon name="lucide:github" />
                            {{ content.market.source }}
                        </a>
                    </article>
                </div>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
import type { MarketItem } from "~/types/api";

type MarketKind = "all" | "skill" | "mcp";

const { alternateLocale, content, locale } = useSiteLocale();
const selectedKind = ref<MarketKind>("all");
const { data } = await useFetch<{ items: MarketItem[] }>("/api/market");
const tabs = computed<Array<{ label: string; value: MarketKind }>>(() => [
    {
        label: locale.value === "zh" ? "全部" : "All",
        value: "all",
    },
    {
        label: content.value.market.skill,
        value: "skill",
    },
    {
        label: content.value.market.mcp,
        value: "mcp",
    },
]);
const filteredItems = computed(() => {
    const items = data.value?.items ?? [];

    if (selectedKind.value === "all") {
        return items;
    }

    return items.filter((item) => item.kind === selectedKind.value);
});

function ecosystemLabel(item: MarketItem): string {
    if (item.slug.includes("openclaw")) {
        return "OpenClaw";
    }

    if (item.slug.includes("hermes")) {
        return "Hermes";
    }

    return "";
}

useSeoMeta({
    description: () => content.value.market.body,
    title: "Market",
});

useHead({
    htmlAttrs: {
        lang: () => (locale.value === "zh" ? "zh-CN" : "en"),
    },
});
</script>

<style scoped>
.market-section {
    margin: 0 auto;
    max-width: 1160px;
    padding: 24px 24px 88px;
}

.market-tabs {
    background: var(--color-surface);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    display: inline-flex;
    gap: 4px;
    padding: 4px;
}

.market-tabs button {
    background: transparent;
    border-radius: 6px;
    color: var(--color-muted);
    cursor: pointer;
    font-weight: 900;
    min-height: 38px;
    padding: 0 16px;
}

.market-tabs button.is-active {
    background: var(--color-text);
    color: var(--color-surface);
}

.market-grid {
    display: grid;
    gap: 18px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: 24px;
}

.market-card {
    display: grid;
    gap: 16px;
    padding: 24px;
}

.market-card__top {
    display: grid;
    gap: 6px;
}

.market-card__top span {
    color: var(--color-leaf);
    font-size: 0.78rem;
    font-weight: 900;
    text-transform: uppercase;
}

.market-card__top strong {
    font-size: 1.2rem;
}

.market-card__ecosystem {
    background: color-mix(in srgb, var(--color-orchid) 16%, var(--color-surface));
    border: 1px solid color-mix(in srgb, var(--color-orchid) 32%, var(--color-line));
    border-radius: 8px;
    color: var(--color-cedar);
    font-size: 0.82rem;
    font-weight: 900;
    padding: 8px 10px;
    width: fit-content;
}

.market-card p {
    color: var(--color-muted);
    margin: 0;
}

.market-card__description {
    min-height: 72px;
}

.market-card__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 10px;
}

.market-card__meta span {
    align-items: center;
    background: var(--color-surface-soft);
    border-radius: 8px;
    color: var(--color-muted);
    display: inline-flex;
    font-weight: 800;
    gap: 6px;
    padding: 8px 10px;
}

.market-card__install {
    background: color-mix(in srgb, #171712 86%, var(--color-surface));
    border-radius: 8px;
    color: #fffdf7;
    display: grid;
    gap: 8px;
    padding: 14px;
}

.market-card__install span {
    color: #d8d1c1;
    font-size: 0.82rem;
    font-weight: 900;
}

.market-card__install code {
    display: block;
    overflow-wrap: anywhere;
    word-break: break-word;
}

@media (max-width: 980px) {
    .market-grid {
        grid-template-columns: 1fr;
    }
}
</style>
