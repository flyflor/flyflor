<template>
    <main class="redirect-page">
        <NuxtLink to="/zh">Flyflor</NuxtLink>
    </main>
</template>

<script setup lang="ts">
await navigateTo("/zh", { replace: true });
</script>

<style scoped>
.redirect-page {
    align-items: center;
    display: flex;
    min-height: 100vh;
    justify-content: center;
}
</style>
