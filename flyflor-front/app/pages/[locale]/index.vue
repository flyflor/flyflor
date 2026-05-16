<template>
    <div class="page-shell">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main>
            <section class="hero">
                <div class="hero__backdrop" aria-hidden="true">
                    <img src="/brand/flyflor-ip-logo.png" alt="" />
                </div>
                <div class="hero__content reveal-flip">
                    <p class="eyebrow">{{ content.hero.eyebrow }}</p>
                    <h1>{{ content.hero.title }}</h1>
                    <p>{{ content.hero.subtitle }}</p>
                    <div class="button-row">
                        <a class="button button--primary" href="#install">
                            <Icon name="lucide:terminal" />
                            {{ content.hero.primaryAction }}
                        </a>
                        <NuxtLink class="button button--secondary" :to="`/${locale}/docs`">
                            <Icon name="lucide:book-open" />
                            {{ content.hero.secondaryAction }}
                        </NuxtLink>
                        <a class="button button--ghost" :href="content.repoUrl" rel="noreferrer" target="_blank">
                            <Icon name="lucide:github" />
                            {{ content.hero.sourceAction }}
                        </a>
                    </div>
                </div>

                <div class="hero__visual reveal-flip" aria-label="Flyflor runtime map">
                    <div class="brand-orbit">
                        <img src="/brand/flyflor-ip-logo.png" alt="Flyflor IP logo" />
                        <div class="brand-orbit__ring"></div>
                        <div class="brand-orbit__badge brand-orbit__badge--top">
                            <span>Gateway</span>
                            <strong>Channels</strong>
                        </div>
                        <div class="brand-orbit__badge brand-orbit__badge--middle">
                            <span>Runtime</span>
                            <strong>Blackboard</strong>
                        </div>
                        <div class="brand-orbit__badge brand-orbit__badge--bottom">
                            <span>Ecosystem</span>
                            <strong>Skill / MCP</strong>
                        </div>
                    </div>
                </div>
            </section>

            <section class="section reveal-flip">
                <div class="section__inner">
                    <p class="eyebrow">Agent</p>
                    <h2 class="section-title">{{ content.agent.title }}</h2>
                    <p class="section-copy">{{ content.agent.body }}</p>
                    <div class="card-grid">
                        <article v-for="item in content.agent.items" :key="item.title" class="info-card reveal-flip">
                            <h3>{{ item.title }}</h3>
                            <p>{{ item.body }}</p>
                        </article>
                    </div>
                </div>
            </section>

            <InstallPanel :content="content" />

            <section class="section product-band reveal-flip">
                <div class="section__inner product-grid">
                    <div>
                        <p class="eyebrow">About</p>
                        <h2 class="section-title">{{ content.about.title }}</h2>
                        <p class="section-copy">{{ content.about.body }}</p>
                        <NuxtLink class="button button--secondary product-link" :to="`/${locale}/about`">
                            <Icon name="lucide:arrow-up-right" />
                            {{ locale === "zh" ? "查看介绍" : "Open about" }}
                        </NuxtLink>
                    </div>
                    <div class="principle-list">
                        <article v-for="item in content.about.principles" :key="item.title">
                            <h3>{{ item.title }}</h3>
                            <p>{{ item.body }}</p>
                        </article>
                    </div>
                </div>
            </section>

            <section class="section ecosystem-band reveal-flip">
                <div class="section__inner ecosystem-grid">
                    <NuxtLink class="ecosystem-card reveal-flip" :to="`/${locale}/market`">
                        <Icon name="lucide:store" />
                        <h2>{{ content.market.title }}</h2>
                        <p>{{ content.market.body }}</p>
                    </NuxtLink>
                    <NuxtLink class="ecosystem-card reveal-flip" :to="`/${locale}/bbs`">
                        <Icon name="lucide:messages-square" />
                        <h2>{{ content.bbs.title }}</h2>
                        <p>{{ content.bbs.body }}</p>
                    </NuxtLink>
                    <NuxtLink class="ecosystem-card reveal-flip" :to="`/${locale}/auth/login`">
                        <Icon name="lucide:user-round-check" />
                        <h2>{{ content.auth.accountTitle }}</h2>
                        <p>{{ content.auth.authCopy }}</p>
                    </NuxtLink>
                </div>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
const { alternateLocale, content, locale } = useSiteLocale();

useSeoMeta({
    description: () => content.value.hero.subtitle,
    ogDescription: () => content.value.hero.subtitle,
    ogTitle: () => "Flyflor",
    title: "Home",
});

useHead({
    htmlAttrs: {
        lang: () => (locale.value === "zh" ? "zh-CN" : "en"),
    },
});
</script>

<style scoped>
.hero {
    align-items: center;
    display: grid;
    gap: 44px;
    grid-template-columns: minmax(0, 1.08fr) minmax(320px, 0.82fr);
    margin: 0 auto;
    max-width: 1280px;
    min-height: calc(100vh - 82px);
    overflow: hidden;
    padding: 42px 24px 76px;
    position: relative;
}

.hero::before {
    background:
        linear-gradient(90deg, var(--color-bg) 0%, color-mix(in srgb, var(--color-bg) 96%, transparent) 46%, color-mix(in srgb, var(--color-bg) 52%, transparent) 76%),
        radial-gradient(circle at 78% 42%, color-mix(in srgb, var(--color-orchid) 18%, transparent), transparent 30%);
    content: "";
    inset: 0;
    pointer-events: none;
    position: absolute;
    z-index: 1;
}

.hero__backdrop {
    inset: 0;
    pointer-events: none;
    position: absolute;
}

.hero__backdrop img {
    filter: saturate(1.16) contrast(1.04);
    height: 100%;
    object-fit: cover;
    object-position: 82% 42%;
    opacity: 0.16;
    transform: scale(1.08);
    width: 100%;
}

.hero__content,
.hero__visual {
    position: relative;
    z-index: 2;
}

.hero__content {
    background: linear-gradient(90deg, color-mix(in srgb, var(--color-bg) 92%, transparent), transparent);
    border-radius: 8px;
    padding: 18px 0;
}

.hero__content h1 {
    font-family: var(--font-display);
    font-size: clamp(4.2rem, 12vw, 9.2rem);
    font-weight: 900;
    letter-spacing: 0;
    line-height: 0.9;
    margin: 0;
}

.hero__content p:not(.eyebrow) {
    color: var(--color-muted);
    font-size: clamp(1.1rem, 2vw, 1.35rem);
    margin: 24px 0 28px;
    max-width: 680px;
}

.hero__visual {
    justify-self: end;
    min-height: clamp(360px, 54vh, 560px);
    position: relative;
    width: min(100%, 520px);
}

.brand-orbit {
    animation: hero-reveal 680ms ease both;
    aspect-ratio: 1;
    border: 1px solid color-mix(in srgb, var(--color-sky) 30%, transparent);
    border-radius: 18px;
    box-shadow:
        0 34px 100px rgba(0, 0, 0, 0.28),
        0 0 80px color-mix(in srgb, var(--color-orchid) 24%, transparent);
    overflow: hidden;
    inset: 0;
    position: absolute;
}

.brand-orbit img {
    display: block;
    height: 100%;
    object-fit: cover;
    width: 100%;
}

.brand-orbit::after {
    background:
        linear-gradient(180deg, transparent 28%, rgba(7, 10, 25, 0.6)),
        radial-gradient(circle at 50% 52%, transparent 46%, rgba(7, 10, 25, 0.52));
    content: "";
    inset: 0;
    position: absolute;
}

.brand-orbit__ring {
    border: 1px solid color-mix(in srgb, var(--color-sky) 72%, transparent);
    border-radius: 999px;
    box-shadow: 0 0 42px color-mix(in srgb, var(--color-orchid) 42%, transparent);
    inset: 28px;
    position: absolute;
    z-index: 1;
}

.brand-orbit__badge {
    animation: badge-enter 560ms ease both;
    background: rgba(9, 11, 22, 0.62);
    border: 1px solid color-mix(in srgb, var(--color-surface) 28%, transparent);
    border-radius: 8px;
    color: #fffdf8;
    display: grid;
    gap: 2px;
    min-width: 132px;
    padding: 10px 12px;
    position: absolute;
    z-index: 2;
}

.brand-orbit__badge span {
    color: rgba(255, 253, 248, 0.72);
    font-size: 0.76rem;
    font-weight: 900;
}

.brand-orbit__badge strong {
    font-size: 0.98rem;
}

.brand-orbit__badge--top {
    right: 18px;
    top: 20px;
}

.brand-orbit__badge--middle {
    animation-delay: 90ms;
    left: 18px;
    top: 44%;
}

.brand-orbit__badge--bottom {
    animation-delay: 180ms;
    bottom: 20px;
    right: 18px;
}

.product-band {
    background: color-mix(in srgb, var(--color-surface) 54%, transparent);
    border-bottom: 1px solid var(--color-line);
    border-top: 1px solid var(--color-line);
}

.product-grid {
    display: grid;
    gap: 48px;
    grid-template-columns: minmax(0, 0.95fr) minmax(0, 1fr);
}

.product-link {
    margin-top: 24px;
}

.principle-list {
    display: grid;
    gap: 16px;
}

.principle-list article {
    border-left: 3px solid var(--color-leaf);
    padding-left: 20px;
}

.principle-list h3,
.principle-list p {
    margin: 0;
}

.principle-list p {
    color: var(--color-muted);
    margin-top: 8px;
}

.ecosystem-grid {
    display: grid;
    gap: 18px;
    grid-template-columns: repeat(3, minmax(0, 1fr));
}

.ecosystem-card {
    background: var(--color-surface);
    border: 1px solid var(--color-line);
    border-radius: 8px;
    box-shadow: var(--shadow-tight);
    display: grid;
    gap: 14px;
    min-height: 260px;
    padding: 28px;
    transition:
        border-color 180ms ease,
        box-shadow 180ms ease,
        transform 180ms ease;
}

.ecosystem-card:hover {
    border-color: color-mix(in srgb, var(--color-orchid) 42%, var(--color-line));
    box-shadow: var(--shadow-soft);
    transform: translateY(-6px) rotateX(2deg);
}

.ecosystem-card svg {
    color: var(--color-leaf);
    font-size: 1.8rem;
}

@keyframes badge-enter {
    0% {
        opacity: 0;
        transform: translateY(12px) scale(0.96);
    }

    100% {
        opacity: 1;
        transform: translateY(0) scale(1);
    }
}

@keyframes hero-reveal {
    0% {
        opacity: 0;
        transform: translateX(34px) scale(1.03);
    }

    100% {
        opacity: 1;
        transform: translateX(0) scale(1);
    }
}

.ecosystem-card h2,
.ecosystem-card p {
    margin: 0;
}

.ecosystem-card p {
    color: var(--color-muted);
}

@media (max-width: 900px) {
    .hero,
    .product-grid,
    .ecosystem-grid {
        grid-template-columns: 1fr;
    }

    .hero {
        min-height: auto;
        padding: 34px 18px 64px;
    }

    .hero__visual {
        justify-self: stretch;
        min-height: 360px;
        width: 100%;
    }

    .brand-orbit {
        inset: 0;
    }
}
</style>
