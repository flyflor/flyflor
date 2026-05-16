import { createSession, isAdminEmail, verifyOAuthState } from "../../../utils/auth";
import { database } from "../../../utils/database";
import { getGitHubOAuthConfig, redirectToGitHubLoginError } from "../../../utils/github.oauth";

type GitHubUser = {
    avatar_url: string | null;
    email: string | null;
    id: number;
    login: string;
    name: string | null;
};

type GitHubEmail = {
    email: string;
    primary: boolean;
    verified: boolean;
};

export default defineEventHandler(async (event) => {
    const github = getGitHubOAuthConfig(event);
    const query = getQuery(event);
    const code = typeof query.code === "string" ? query.code : "";
    const state = typeof query.state === "string" ? query.state : "";

    if (!github.clientId || !github.clientSecret) {
        return redirectToGitHubLoginError(event, "not_configured");
    }

    if (!code || !state || !verifyOAuthState(event, state)) {
        throw createError({
            statusCode: 400,
            statusMessage: "Invalid GitHub OAuth callback.",
        });
    }

    // Keep the callback aligned with the configured deployed URL; the origin fallback is only for local/dev.
    const redirectUri =
        github.redirectUri ||
        `${getRequestURL(event).origin}/auth/github/callback`;
    const tokenResponse = await $fetch<{ access_token: string }>("https://github.com/login/oauth/access_token", {
        body: {
            client_id: github.clientId,
            client_secret: github.clientSecret,
            code,
            redirect_uri: redirectUri,
            state,
        },
        headers: {
            Accept: "application/json",
        },
        method: "POST",
    });

    const accessToken = tokenResponse.access_token;

    if (!accessToken) {
        throw createError({
            statusCode: 401,
            statusMessage: "GitHub did not return an access token.",
        });
    }

    const profile = await $fetch<GitHubUser>("https://api.github.com/user", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "flyflor-front",
        },
    });
    const emails = await $fetch<GitHubEmail[]>("https://api.github.com/user/emails", {
        headers: {
            Authorization: `Bearer ${accessToken}`,
            "User-Agent": "flyflor-front",
        },
    });
    const primaryEmail = profile.email || emails.find((item) => item.primary && item.verified)?.email;

    if (!primaryEmail) {
        throw createError({
            statusCode: 422,
            statusMessage: "GitHub account has no verified email.",
        });
    }

    const existingByGithub = database
        .query("SELECT * FROM users WHERE github_id = $githubId")
        .get({ $githubId: String(profile.id) }) as { id: number } | null;
    const existingByEmail = database
        .query("SELECT * FROM users WHERE email = $email")
        .get({ $email: primaryEmail.toLowerCase() }) as { id: number } | null;

    let userId = existingByGithub?.id || existingByEmail?.id;

    if (userId) {
        database
            .query("UPDATE users SET github_id = $githubId, avatar_url = $avatarUrl, is_admin = CASE WHEN $isAdmin = 1 THEN 1 ELSE is_admin END WHERE id = $id")
            .run({
                $avatarUrl: profile.avatar_url,
                $githubId: String(profile.id),
                $id: userId,
                $isAdmin: isAdminEmail(primaryEmail) ? 1 : 0,
            });
    } else {
        const userCount = database.query("SELECT COUNT(*) AS count FROM users").get() as { count: number };
        const result = database
            .query(`
                INSERT INTO users (
                    email,
                    name,
                    github_id,
                    avatar_url,
                    is_admin
                )
                VALUES (
                    $email,
                    $name,
                    $githubId,
                    $avatarUrl,
                    $isAdmin
                )
            `)
            .run({
                $avatarUrl: profile.avatar_url,
                $email: primaryEmail.toLowerCase(),
                $githubId: String(profile.id),
                $isAdmin: userCount.count === 0 || isAdminEmail(primaryEmail) ? 1 : 0,
                $name: profile.name || profile.login,
            });

        userId = Number(result.lastInsertRowid);
    }

    createSession(event, userId);

    return sendRedirect(event, "/zh");
});
