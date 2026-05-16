<template>
    <div class="page-shell">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main>
            <section class="page-hero reveal-flip">
                <p class="eyebrow">About</p>
                <h1>{{ content.about.title }}</h1>
                <p>{{ content.about.body }}</p>
            </section>

            <section class="section reveal-flip">
                <div class="section__inner about-grid">
                    <article v-for="item in content.about.principles" :key="item.title" class="info-card reveal-flip">
                        <h2>{{ item.title }}</h2>
                        <p>{{ item.body }}</p>
                    </article>
                </div>
            </section>

            <section class="section about-runtime reveal-flip">
                <div class="section__inner runtime-grid">
                    <div>
                        <p class="eyebrow">Runtime</p>
                        <h2 class="section-title">{{ content.agent.title }}</h2>
                        <p class="section-copy">{{ content.agent.body }}</p>
                    </div>
                    <div class="runtime-list">
                        <article v-for="item in content.agent.items" :key="item.title" class="reveal-flip">
                            <h3>{{ item.title }}</h3>
                            <p>{{ item.body }}</p>
                        </article>
                    </div>
                </div>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
const { alternateLocale, content, locale } = useSiteLocale();

useSeoMeta({
    description: () => content.value.about.body,
    title: "About",
});

useHead({
    htmlAttrs: {
        lang: () => (locale.value === "zh" ? "zh-CN" : "en"),
    },
});
</script>

<style scoped>
.about-grid {
    display: grid;
    gap: 18px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.about-grid h2 {
    font-size: 1.2rem;
    margin: 0 0 10px;
}

.about-runtime {
    background: color-mix(in srgb, var(--color-surface) 54%, transparent);
    border-top: 1px solid var(--color-line);
}

.runtime-grid {
    display: grid;
    gap: 46px;
    grid-template-columns: minmax(0, 0.9fr) minmax(0, 1fr);
}

.runtime-list {
    display: grid;
    gap: 16px;
}

.runtime-list article {
    background: var(--color-surface);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    padding: 22px;
}

.runtime-list h3,
.runtime-list p {
    margin: 0;
}

.runtime-list p {
    color: var(--color-muted);
    margin-top: 8px;
}

@media (max-width: 900px) {
    .about-grid,
    .runtime-grid {
        grid-template-columns: 1fr;
    }
}
</style>
