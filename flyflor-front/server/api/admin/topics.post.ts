import { getCurrentUser } from "../../utils/auth";
import { database, listAdminTopics } from "../../utils/database";

type TopicAction = "delete" | "update";

type TopicBody = {
    action?: TopicAction;
    authorName?: string;
    bodyEn?: string;
    bodyZh?: string;
    boardKey?: string;
    id?: number;
    likes?: number;
    replies?: number;
    titleEn?: string;
    titleZh?: string;
    views?: number;
};

export default defineEventHandler(async (event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    const body = await readBody<TopicBody>(event);

    if (body.action === "update") {
        updateTopic(body);
    } else if (body.action === "delete") {
        deleteTopic(body);
    } else {
        throw createError({
            statusCode: 400,
            statusMessage: "Unsupported topic action.",
        });
    }

    return {
        topics: listAdminTopics(),
    };
});

function updateTopic(body: TopicBody): void {
    const id = Number(body.id);
    const boardKey = body.boardKey?.trim().toLowerCase();
    const authorName = body.authorName?.trim();
    const titleZh = body.titleZh?.trim();
    const titleEn = body.titleEn?.trim();
    const bodyZh = body.bodyZh?.trim();
    const bodyEn = body.bodyEn?.trim();
    const replies = Number(body.replies);
    const views = Number(body.views);
    const likes = Number(body.likes);

    if (
        !Number.isInteger(id) ||
        id <= 0 ||
        !boardKey ||
        !authorName ||
        !titleZh ||
        !titleEn ||
        !bodyZh ||
        !bodyEn ||
        !Number.isInteger(replies) ||
        replies < 0 ||
        !Number.isInteger(views) ||
        views < 0 ||
        !Number.isInteger(likes) ||
        likes < 0
    ) {
        throw createError({
            statusCode: 400,
            statusMessage: "Topic fields are incomplete.",
        });
    }

    const board = database.query("SELECT key FROM boards WHERE key = $boardKey").get({ $boardKey: boardKey }) as {
        key: string;
    } | null;

    if (!board) {
        throw createError({
            statusCode: 404,
            statusMessage: "Board was not found.",
        });
    }

    database
        .query(`
            UPDATE topics
            SET
                board_key = $boardKey,
                author_name = $authorName,
                title_zh = $titleZh,
                title_en = $titleEn,
                body_zh = $bodyZh,
                body_en = $bodyEn,
                replies = $replies,
                views = $views,
                likes = $likes
            WHERE id = $id
        `)
        .run({
            $authorName: authorName,
            $bodyEn: bodyEn,
            $bodyZh: bodyZh,
            $boardKey: boardKey,
            $id: id,
            $likes: likes,
            $replies: replies,
            $titleEn: titleEn,
            $titleZh: titleZh,
            $views: views,
        });
}

function deleteTopic(body: TopicBody): void {
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
        throw createError({
            statusCode: 400,
            statusMessage: "Topic id is required.",
        });
    }

    database.query("DELETE FROM topics WHERE id = $id").run({ $id: id });
}
