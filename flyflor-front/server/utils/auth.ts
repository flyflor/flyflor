import { createHash, randomBytes } from "node:crypto";
import type { H3Event } from "h3";
import { database, getUserBySessionToken, serializeUser } from "./database";

const sessionMaxAgeSeconds = 60 * 60 * 24 * 30;

export type PublicUser = ReturnType<typeof serializeUser>;

export function isAdminEmail(email: string): boolean {
    const normalized = email.trim().toLowerCase();
    const adminEmails = (process.env.ADMIN_EMAILS || "")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter(Boolean);

    return adminEmails.includes(normalized);
}

export async function hashPassword(password: string): Promise<string> {
    const salt = randomBytes(16).toString("hex");
    const hash = await Bun.password.hash(`${salt}:${password}`, {
        algorithm: "argon2id",
    });

    return `${salt}:${hash}`;
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
    const [salt, hash] = storedHash.split(":");

    if (!salt || !hash) {
        return false;
    }

    return Bun.password.verify(`${salt}:${password}`, hash);
}

export function createSession(event: H3Event, userId: number): string {
    const config = useRuntimeConfig(event);
    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + sessionMaxAgeSeconds * 1000);

    database
        .query("INSERT INTO sessions (token, user_id, expires_at) VALUES ($token, $userId, $expiresAt)")
        .run({
            $expiresAt: expiresAt.toISOString(),
            $token: token,
            $userId: userId,
        });

    setCookie(event, config.authCookieName, token, {
        httpOnly: true,
        maxAge: sessionMaxAgeSeconds,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
    });

    return token;
}

export function clearAuthSession(event: H3Event): void {
    const config = useRuntimeConfig(event);
    const token = getCookie(event, config.authCookieName);

    if (token) {
        database.query("DELETE FROM sessions WHERE token = $token").run({ $token: token });
    }

    deleteCookie(event, config.authCookieName, {
        path: "/",
    });
}

export function getCurrentUser(event: H3Event): PublicUser | null {
    const config = useRuntimeConfig(event);
    const token = getCookie(event, config.authCookieName);

    if (!token) {
        return null;
    }

    const user = getUserBySessionToken(token);

    return user ? serializeUser(user) : null;
}

export function createOAuthState(event: H3Event): string {
    const state = randomBytes(24).toString("hex");
    const signed = createHash("sha256").update(state).digest("hex");

    setCookie(event, "flyflor_oauth_state", `${state}.${signed}`, {
        httpOnly: true,
        maxAge: 600,
        path: "/",
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
    });

    return state;
}

export function verifyOAuthState(event: H3Event, state: string): boolean {
    const cookie = getCookie(event, "flyflor_oauth_state");

    if (!cookie) {
        return false;
    }

    const [storedState, storedSignature] = cookie.split(".");
    const expectedSignature = createHash("sha256").update(storedState ?? "").digest("hex");

    deleteCookie(event, "flyflor_oauth_state", {
        path: "/",
    });

    return storedState === state && storedSignature === expectedSignature;
}
