import { getCurrentUser } from "../../utils/auth";
import { database, listAdminComments } from "../../utils/database";

type CommentAction = "delete" | "update";

type CommentBody = {
    action?: CommentAction;
    authorName?: string;
    bodyEn?: string;
    bodyZh?: string;
    id?: number;
    topicId?: number;
};

export default defineEventHandler(async (event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    const body = await readBody<CommentBody>(event);

    if (body.action === "update") {
        updateComment(body);
    } else if (body.action === "delete") {
        deleteComment(body);
    } else {
        throw createError({
            statusCode: 400,
            statusMessage: "Unsupported comment action.",
        });
    }

    return {
        comments: listAdminComments(),
    };
});

function updateComment(body: CommentBody): void {
    const id = Number(body.id);
    const topicId = Number(body.topicId);
    const authorName = body.authorName?.trim();
    const bodyZh = body.bodyZh?.trim();
    const bodyEn = body.bodyEn?.trim();

    if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(topicId) || topicId <= 0 || !authorName || !bodyZh || !bodyEn) {
        throw createError({
            statusCode: 400,
            statusMessage: "Comment fields are incomplete.",
        });
    }

    const topic = database.query("SELECT id FROM topics WHERE id = $topicId").get({ $topicId: topicId }) as {
        id: number;
    } | null;

    if (!topic) {
        throw createError({
            statusCode: 404,
            statusMessage: "Topic was not found.",
        });
    }

    database
        .query(`
            UPDATE comments
            SET
                topic_id = $topicId,
                author_name = $authorName,
                body_zh = $bodyZh,
                body_en = $bodyEn
            WHERE id = $id
        `)
        .run({
            $authorName: authorName,
            $bodyEn: bodyEn,
            $bodyZh: bodyZh,
            $id: id,
            $topicId: topicId,
        });
}

function deleteComment(body: CommentBody): void {
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
        throw createError({
            statusCode: 400,
            statusMessage: "Comment id is required.",
        });
    }

    database.query("DELETE FROM comments WHERE id = $id").run({ $id: id });
}
