export type ThemePreference = "light" | "dark" | "system";

const themeState = () => useState<ThemePreference>("theme-preference", () => "system");

export function useTheme() {
    const preference = themeState();
    const labels = {
        dark: "Dark",
        light: "Light",
        system: "System",
    };

    function applyTheme(nextPreference = preference.value): void {
        if (!import.meta.client) {
            return;
        }

        const systemDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
        const resolved = nextPreference === "system" ? (systemDark ? "dark" : "light") : nextPreference;

        document.documentElement.dataset.theme = resolved;
        document.documentElement.dataset.themePreference = nextPreference;
        window.localStorage.setItem("flyflor-theme", nextPreference);
    }

    function setTheme(nextPreference: ThemePreference): void {
        preference.value = nextPreference;
        applyTheme(nextPreference);
    }

    function initTheme(): void {
        if (!import.meta.client) {
            return;
        }

        const stored = window.localStorage.getItem("flyflor-theme");

        if (stored === "light" || stored === "dark" || stored === "system") {
            preference.value = stored;
        }

        applyTheme(preference.value);
        window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (preference.value === "system") {
                applyTheme("system");
            }
        });
    }

    return {
        initTheme,
        labels,
        preference,
        setTheme,
    };
}
