<template>
    <footer class="site-footer">
        <p>{{ content.footer.tagline }}</p>
        <div class="site-footer__links">
            <a :href="content.repoUrl" rel="noreferrer" target="_blank">{{ content.footer.repo }}</a>
            <NuxtLink :to="`/${content.locale}/docs`">{{ content.footer.docs }}</NuxtLink>
        </div>
    </footer>
</template>

<script setup lang="ts">
import type { SiteContent } from "~/data/site.content";

defineProps<{
    content: SiteContent;
}>();
</script>

<style scoped>
.site-footer {
    align-items: center;
    border-top: 1px solid var(--color-line);
    color: var(--color-muted);
    display: flex;
    justify-content: space-between;
    margin: 0 auto;
    max-width: 1120px;
    padding: 30px 24px 44px;
}

.site-footer p {
    margin: 0;
}

.site-footer__links {
    display: flex;
    gap: 18px;
    font-weight: 800;
}

@media (max-width: 720px) {
    .site-footer {
        align-items: flex-start;
        flex-direction: column;
        gap: 16px;
    }
}
</style>
