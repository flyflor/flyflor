<template>
    <NuxtRouteAnnouncer />
    <ExperienceFx />
    <NuxtPage />
</template>

<script setup lang="ts">
const { initTheme } = useTheme();
const { refreshUser } = useAuth();
const route = useRoute();
let cursorFrame = 0;
let cursorX = 0;
let cursorY = 0;
let revealObserver: IntersectionObserver | null = null;

onMounted(() => {
    initTheme();
    void refreshUser();
    window.addEventListener("pointermove", updateCursor);
    setupRevealObserver();
});

onBeforeUnmount(() => {
    window.removeEventListener("pointermove", updateCursor);
    revealObserver?.disconnect();
});

watch(
    () => route.fullPath,
    async () => {
        await nextTick();
        setupRevealObserver();
    },
);

function updateCursor(event: PointerEvent): void {
    cursorX = event.clientX;
    cursorY = event.clientY;

    if (cursorFrame) {
        return;
    }

    cursorFrame = window.requestAnimationFrame(() => {
        document.documentElement.style.setProperty("--cursor-x", `${cursorX}px`);
        document.documentElement.style.setProperty("--cursor-y", `${cursorY}px`);
        cursorFrame = 0;
    });
}

function setupRevealObserver(): void {
    revealObserver?.disconnect();
    const elements = document.querySelectorAll<HTMLElement>(".reveal-flip");

    if (!elements.length) {
        return;
    }

    revealObserver = new IntersectionObserver(
        (entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) {
                    continue;
                }

                entry.target.classList.add("is-revealed");
                revealObserver?.unobserve(entry.target);
            }
        },
        {
            rootMargin: "0px 0px -12% 0px",
            threshold: 0.12,
        },
    );

    for (const element of elements) {
        revealObserver.observe(element);
    }
}

useHead({
    titleTemplate: (title) => (title ? `${title} · Flyflor` : "Flyflor"),
});
</script>

<style scoped>
:global(html) {
    scroll-behavior: smooth;
}
</style>
