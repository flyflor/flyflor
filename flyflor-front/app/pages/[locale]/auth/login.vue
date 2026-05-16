<template>
    <div class="page-shell">
        <SiteHeader :alternate-locale="alternateLocale" :content="content" />

        <main class="auth-page">
            <section class="auth-panel surface-panel">
                <div>
                    <p class="eyebrow">{{ content.auth.accountTitle }}</p>
                    <h1>{{ content.auth.login }}</h1>
                    <p>{{ content.auth.authCopy }}</p>
                    <p v-if="githubMessage" class="auth-error">{{ githubMessage }}</p>
                </div>

                <form class="auth-form" @submit.prevent="submitLogin">
                    <label>
                        <span>{{ content.auth.email }}</span>
                        <input v-model="email" autocomplete="email" required type="email" />
                    </label>
                    <label>
                        <span>{{ content.auth.password }}</span>
                        <input v-model="password" autocomplete="current-password" required type="password" />
                    </label>
                    <p v-if="error" class="auth-error">{{ error }}</p>
                    <button class="button button--primary" type="submit">
                        <Icon name="lucide:log-in" />
                        {{ content.auth.login }}
                    </button>
                </form>

                <button class="button button--secondary" type="button" @click="startGitHubLogin">
                    <Icon name="lucide:github" />
                    {{ content.auth.github }}
                </button>

                <p class="auth-switch">
                    {{ content.auth.noAccount }}
                    <NuxtLink :to="`/${locale}/auth/register`">{{ content.auth.register }}</NuxtLink>
                </p>
            </section>
        </main>

        <SiteFooter :content="content" />
    </div>
</template>

<script setup lang="ts">
const route = useRoute();
const router = useRouter();
const { alternateLocale, content, locale } = useSiteLocale();
const { login } = useAuth();
const email = ref("");
const password = ref("");
const error = ref("");
const githubMessage = computed(() => {
    if (route.query.github !== "not_configured") {
        return "";
    }

    return locale.value === "zh"
        ? "GitHub 登录尚未配置。请设置 GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET，或 NUXT_GITHUB_CLIENT_ID / NUXT_GITHUB_CLIENT_SECRET。"
        : "GitHub login is not configured. Set GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET, or NUXT_GITHUB_CLIENT_ID / NUXT_GITHUB_CLIENT_SECRET.";
});

async function submitLogin(): Promise<void> {
    error.value = "";

    try {
        await login(email.value, password.value);
        await router.push(`/${locale.value}/bbs`);
    } catch (requestError) {
        error.value = requestError instanceof Error ? requestError.message : "Login failed.";
    }
}

function startGitHubLogin(): void {
    window.location.href = "/auth/github";
}

useSeoMeta({
    title: "Login",
});
</script>

<style scoped>
.auth-page {
    display: grid;
    min-height: calc(100vh - 180px);
    place-items: center;
    padding: 42px 24px 88px;
}

.auth-panel {
    display: grid;
    gap: 22px;
    max-width: 520px;
    padding: 30px;
    width: 100%;
}

.auth-panel h1,
.auth-panel p {
    margin: 0;
}

.auth-panel p {
    color: var(--color-muted);
    margin-top: 10px;
}

.auth-form,
.auth-form label {
    display: grid;
    gap: 10px;
}

.auth-form label span {
    color: var(--color-muted);
    font-weight: 900;
}

.auth-error {
    color: var(--color-cedar);
    font-weight: 900;
}

.auth-switch a {
    color: var(--color-leaf);
    font-weight: 900;
}
</style>
