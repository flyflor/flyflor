<template>
    <div class="page-shell">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main>
            <section class="page-hero reveal-flip">
                <p class="eyebrow">Docs</p>
                <h1>{{ content.docs.title }}</h1>
                <p>{{ content.docs.body }}</p>
            </section>

            <section class="doc-layout reveal-flip">
                <aside class="doc-nav surface-panel reveal-flip">
                    <a href="#install">{{ content.install.title }}</a>
                    <a v-for="section in content.docs.sections" :key="section.title" :href="`#${slug(section.title)}`">
                        {{ section.title }}
                    </a>
                    <a href="#github">GitHub</a>
                </aside>

                <div class="doc-content">
                    <article id="install" class="doc-section surface-panel reveal-flip">
                        <h2>{{ content.install.title }}</h2>
                        <p>{{ content.install.body }}</p>
                        <div class="doc-code-list">
                            <div v-for="block in content.install.blocks" :key="block.title" class="doc-code">
                                <h3>{{ block.title }}</h3>
                                <pre><code>{{ block.code }}</code></pre>
                            </div>
                        </div>
                    </article>

                    <article
                        v-for="section in content.docs.sections"
                        :id="slug(section.title)"
                        :key="section.title"
                        class="doc-section surface-panel reveal-flip"
                    >
                        <h2>{{ section.title }}</h2>
                        <p>{{ section.body }}</p>
                        <ul>
                            <li v-for="bullet in section.bullets" :key="bullet">{{ bullet }}</li>
                        </ul>
                        <pre v-if="section.code" class="doc-example"><code>{{ section.code }}</code></pre>
                    </article>

                    <article id="github" class="doc-section surface-panel reveal-flip">
                        <h2>GitHub</h2>
                        <p>{{ content.hero.sourceAction }}</p>
                        <a class="button button--primary" :href="content.repoUrl" rel="noreferrer" target="_blank">
                            <Icon name="lucide:github" />
                            {{ content.footer.repo }}
                        </a>
                    </article>
                </div>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
const { alternateLocale, content, locale } = useSiteLocale();

function slug(value: string): string {
    return value.toLowerCase().replaceAll(" ", "-");
}

useSeoMeta({
    description: () => content.value.docs.body,
    title: "Docs",
});

useHead({
    htmlAttrs: {
        lang: () => (locale.value === "zh" ? "zh-CN" : "en"),
    },
});
</script>

<style scoped>
.doc-layout {
    align-items: start;
    display: grid;
    gap: 38px;
    grid-template-columns: 240px minmax(0, 1fr);
    margin: 0 auto;
    max-width: 1160px;
    padding: 24px 24px 88px;
}

.doc-nav {
    display: grid;
    gap: 8px;
    padding: 16px;
    position: sticky;
    top: 16px;
}

.doc-nav a {
    color: var(--color-muted);
    font-weight: 900;
    padding: 8px;
}

.doc-content {
    display: grid;
    gap: 22px;
}

.doc-section {
    padding: 28px;
}

.doc-section h2,
.doc-section h3,
.doc-section p {
    margin: 0;
}

.doc-section p {
    color: var(--color-muted);
    margin-top: 10px;
}

.doc-section ul {
    color: var(--color-muted);
    display: grid;
    gap: 8px;
    margin: 18px 0 0;
    padding-left: 20px;
}

.doc-section .button {
    margin-top: 20px;
}

.doc-code-list {
    display: grid;
    gap: 12px;
    margin-top: 18px;
}

.doc-code {
    background: #171712;
    border-radius: 8px;
    color: #fffdf7;
    padding: 18px;
}

.doc-code h3 {
    color: #d8d1c1;
    font-size: 0.92rem;
    margin-bottom: 10px;
}

.doc-example {
    background: #171712;
    border-radius: 8px;
    color: #fffdf7;
    margin-top: 18px;
    padding: 18px;
}

pre {
    margin: 0;
    overflow-x: auto;
}

code {
    font-family: var(--font-mono);
    font-size: 0.92rem;
}

@media (max-width: 840px) {
    .doc-layout {
        grid-template-columns: 1fr;
    }

    .doc-nav {
        position: static;
    }
}
</style>
