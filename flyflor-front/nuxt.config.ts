// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
    app: {
        head: {
            htmlAttrs: {
                lang: "zh-CN",
            },
            link: [
                {
                    rel: "icon",
                    href: "/favicon.svg",
                    type: "image/svg+xml",
                },
            ],
            meta: [
                {
                    name: "viewport",
                    content: "width=device-width, initial-scale=1",
                },
                {
                    name: "description",
                    content: "Flyflor is a local-first agent runtime for observable, recoverable, multi-channel work.",
                },
            ],
            title: "Flyflor",
        },
    },
    compatibilityDate: "2025-07-15",
    css: ["~/assets/css/main.css"],
    devtools: { enabled: true },
    modules: ["@nuxt/icon"],
    nitro: {
        preset: "bun",
    },
    runtimeConfig: {
        authCookieName: "flyflor_session",
        githubClientId: "",
        githubClientSecret: "",
        githubRedirectUri: "",
        public: {
            githubClientReady: false,
        },
    },
    typescript: {
        typeCheck: true,
    },
});
