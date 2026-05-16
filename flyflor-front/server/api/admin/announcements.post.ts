import { getCurrentUser } from "../../utils/auth";
import { database, listAnnouncements } from "../../utils/database";

type AnnouncementBody = {
    bodyEn?: string;
    bodyZh?: string;
    isPinned?: boolean;
    tagEn?: string;
    tagZh?: string;
    titleEn?: string;
    titleZh?: string;
};

export default defineEventHandler(async (event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    const body = await readBody<AnnouncementBody>(event);

    if (!body.titleZh?.trim() || !body.titleEn?.trim() || !body.bodyZh?.trim() || !body.bodyEn?.trim()) {
        throw createError({
            statusCode: 400,
            statusMessage: "Announcement title and body are required in both languages.",
        });
    }

    database
        .query(`
            INSERT INTO announcements (
                title_zh,
                title_en,
                body_zh,
                body_en,
                tag_zh,
                tag_en,
                is_pinned
            )
            VALUES (
                $titleZh,
                $titleEn,
                $bodyZh,
                $bodyEn,
                $tagZh,
                $tagEn,
                $isPinned
            )
        `)
        .run({
            $bodyEn: body.bodyEn.trim(),
            $bodyZh: body.bodyZh.trim(),
            $isPinned: body.isPinned ? 1 : 0,
            $tagEn: body.tagEn?.trim() || "Official",
            $tagZh: body.tagZh?.trim() || "官方",
            $titleEn: body.titleEn.trim(),
            $titleZh: body.titleZh.trim(),
        });

    return {
        announcements: listAnnouncements(),
    };
});
