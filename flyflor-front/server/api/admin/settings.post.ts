import { getCurrentUser } from "../../utils/auth";
import { database, getSiteSettings } from "../../utils/database";

type SettingsBody = {
    accentColor?: string;
    communitySubtitleEn?: string;
    communitySubtitleZh?: string;
    communityTitleEn?: string;
    communityTitleZh?: string;
};

export default defineEventHandler(async (event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    const body = await readBody<SettingsBody>(event);
    const current = getSiteSettings();

    database
        .query(`
            UPDATE site_settings
            SET
                accent_color = $accentColor,
                community_title_zh = $communityTitleZh,
                community_title_en = $communityTitleEn,
                community_subtitle_zh = $communitySubtitleZh,
                community_subtitle_en = $communitySubtitleEn,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = 1
        `)
        .run({
            $accentColor: body.accentColor?.trim() || current.accent_color,
            $communitySubtitleEn: body.communitySubtitleEn?.trim() || current.community_subtitle_en,
            $communitySubtitleZh: body.communitySubtitleZh?.trim() || current.community_subtitle_zh,
            $communityTitleEn: body.communityTitleEn?.trim() || current.community_title_en,
            $communityTitleZh: body.communityTitleZh?.trim() || current.community_title_zh,
        });

    return {
        settings: getSiteSettings(),
    };
});
