import { defaultLocale, siteContent, supportedLocales, type LocaleCode } from "~/data/site.content";

export function normalizeLocale(value: string | string[] | undefined): LocaleCode {
    const candidate = Array.isArray(value) ? value[0] : value;

    if (candidate === "en" || candidate === "zh") {
        return candidate;
    }

    return defaultLocale;
}

export function useSiteLocale() {
    const route = useRoute();
    const locale = computed(() => normalizeLocale(route.params.locale));
    const content = computed(() => siteContent[locale.value]);
    const alternateLocale = computed<LocaleCode>(() => (locale.value === "zh" ? "en" : "zh"));

    return {
        alternateLocale,
        content,
        locale,
        supportedLocales,
    };
}
