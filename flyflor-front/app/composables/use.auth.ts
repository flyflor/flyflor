import type { AuthUser } from "~/types/api";

type AuthResponse = {
    user: AuthUser | null;
};

const userState = () => useState<AuthUser | null>("auth-user", () => null);

export function useAuth() {
    const user = userState();

    async function refreshUser(): Promise<void> {
        const response = await $fetch<AuthResponse>("/api/auth/me");
        user.value = response.user;
    }

    async function login(email: string, password: string): Promise<void> {
        const response = await $fetch<AuthResponse>("/api/auth/login", {
            body: {
                email,
                password,
            },
            method: "POST",
        });

        user.value = response.user;
    }

    async function register(name: string, email: string, password: string): Promise<void> {
        const response = await $fetch<AuthResponse>("/api/auth/register", {
            body: {
                email,
                name,
                password,
            },
            method: "POST",
        });

        user.value = response.user;
    }

    async function logout(): Promise<void> {
        await $fetch("/api/auth/logout", {
            method: "POST",
        });

        user.value = null;
    }

    return {
        login,
        logout,
        refreshUser,
        register,
        user,
    };
}
