import { getCurrentUser } from "../../utils/auth";
import { database, listAnnouncements } from "../../utils/database";

type AnnouncementAction = "create" | "delete" | "update";

type AnnouncementBody = {
    action?: AnnouncementAction;
    bodyEn?: string;
    bodyZh?: string;
    id?: number;
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

    if (body.action === "create") {
        createAnnouncement(body);
    } else if (body.action === "update") {
        updateAnnouncement(body);
    } else if (body.action === "delete") {
        deleteAnnouncement(body);
    } else {
        throw createError({
            statusCode: 400,
            statusMessage: "Unsupported announcement action.",
        });
    }

    return {
        announcements: listAnnouncements(),
    };
});

function createAnnouncement(body: AnnouncementBody): void {
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
}

function updateAnnouncement(body: AnnouncementBody): void {
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0 || !body.titleZh?.trim() || !body.titleEn?.trim() || !body.bodyZh?.trim() || !body.bodyEn?.trim()) {
        throw createError({
            statusCode: 400,
            statusMessage: "Announcement id, title, and body are required in both languages.",
        });
    }

    database
        .query(`
            UPDATE announcements
            SET
                title_zh = $titleZh,
                title_en = $titleEn,
                body_zh = $bodyZh,
                body_en = $bodyEn,
                tag_zh = $tagZh,
                tag_en = $tagEn,
                is_pinned = $isPinned
            WHERE id = $id
        `)
        .run({
            $bodyEn: body.bodyEn.trim(),
            $bodyZh: body.bodyZh.trim(),
            $id: id,
            $isPinned: body.isPinned ? 1 : 0,
            $tagEn: body.tagEn?.trim() || "Official",
            $tagZh: body.tagZh?.trim() || "官方",
            $titleEn: body.titleEn.trim(),
            $titleZh: body.titleZh.trim(),
        });
}

function deleteAnnouncement(body: AnnouncementBody): void {
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
        throw createError({
            statusCode: 400,
            statusMessage: "Announcement id is required.",
        });
    }

    database.query("DELETE FROM announcements WHERE id = $id").run({ $id: id });
}
