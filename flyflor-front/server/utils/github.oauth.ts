import type { H3Event } from "h3";

export function getGitHubOAuthConfig(event: H3Event) {
    const config = useRuntimeConfig(event);

    return {
        clientId: config.githubClientId || process.env.GITHUB_CLIENT_ID || "",
        clientSecret: config.githubClientSecret || process.env.GITHUB_CLIENT_SECRET || "",
        redirectUri: config.githubRedirectUri || process.env.GITHUB_REDIRECT_URI || "",
    };
}

export function redirectToGitHubLoginError(event: H3Event, reason: string) {
    const referer = getRequestHeader(event, "referer");
    const locale = referer?.includes("/en/") ? "en" : "zh";

    return sendRedirect(event, `/${locale}/auth/login?github=${encodeURIComponent(reason)}`);
}
