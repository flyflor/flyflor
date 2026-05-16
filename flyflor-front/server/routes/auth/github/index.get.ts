import { createOAuthState } from "../../../utils/auth";
import { getGitHubOAuthConfig, redirectToGitHubLoginError } from "../../../utils/github.oauth";

export default defineEventHandler((event) => {
    const github = getGitHubOAuthConfig(event);

    if (!github.clientId) {
        return redirectToGitHubLoginError(event, "not_configured");
    }

    const state = createOAuthState(event);
    // Production should set githubRedirectUri to the deployed callback, e.g. https://flyflor.qingshen.xin/auth/github/callback.
    const redirectUri =
        github.redirectUri ||
        `${getRequestURL(event).origin}/auth/github/callback`;
    const params = new URLSearchParams({
        client_id: github.clientId,
        redirect_uri: redirectUri,
        scope: "read:user user:email",
        state,
    });

    return sendRedirect(event, `https://github.com/login/oauth/authorize?${params.toString()}`);
});
