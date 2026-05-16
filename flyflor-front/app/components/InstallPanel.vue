<template>
    <section id="install" class="section install-section reveal-flip">
        <div class="section__inner install-grid">
            <div>
                <p class="eyebrow">Install</p>
                <h2 class="section-title">{{ content.install.title }}</h2>
                <p class="section-copy">{{ content.install.body }}</p>
            </div>

            <div class="terminal-stack" aria-label="Install commands">
                <article v-for="block in content.install.blocks" :key="block.title" class="terminal">
                    <div class="terminal__bar">
                        <span></span>
                        <span></span>
                        <span></span>
                        <strong>{{ block.title }}</strong>
                    </div>
                    <pre><code>{{ block.code }}</code></pre>
                </article>
            </div>
        </div>
    </section>
</template>

<script setup lang="ts">
import type { SiteContent } from "~/data/site.content";

defineProps<{
    content: SiteContent;
}>();
</script>

<style scoped>
.install-section {
    background: rgba(255, 253, 247, 0.64);
    border-bottom: 1px solid var(--color-line);
    border-top: 1px solid var(--color-line);
}

.install-grid {
    align-items: start;
    display: grid;
    gap: 36px;
    grid-template-columns: minmax(0, 0.85fr) minmax(320px, 1fr);
}

.terminal-stack {
    display: grid;
    gap: 14px;
}

.terminal {
    background: #171712;
    border-radius: 8px;
    box-shadow: var(--shadow-soft);
    color: #fffdf7;
    overflow: hidden;
}

.terminal__bar {
    align-items: center;
    background: #2c2b25;
    display: flex;
    gap: 8px;
    padding: 10px 14px;
}

.terminal__bar span {
    border-radius: 999px;
    display: block;
    height: 10px;
    width: 10px;
}

.terminal__bar span:nth-child(1) {
    background: #e16b5c;
}

.terminal__bar span:nth-child(2) {
    background: #d69f2a;
}

.terminal__bar span:nth-child(3) {
    background: #56b276;
}

.terminal__bar strong {
    color: #d8d1c1;
    font-size: 0.82rem;
    margin-left: 6px;
}

pre {
    margin: 0;
    overflow-x: auto;
    padding: 18px;
}

code {
    font-family: "SFMono-Regular", Consolas, "Liberation Mono", monospace;
    font-size: 0.92rem;
}

@media (max-width: 900px) {
    .install-grid {
        grid-template-columns: 1fr;
    }
}
</style>
