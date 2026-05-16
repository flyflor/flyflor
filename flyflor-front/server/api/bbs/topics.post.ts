import { getCurrentUser } from "../../utils/auth";
import { database, listTopics } from "../../utils/database";

type TopicBody = {
    boardKey?: string;
    title?: string;
    body?: string;
};

export default defineEventHandler(async (event) => {
    const user = getCurrentUser(event);

    if (!user) {
        throw createError({
            statusCode: 401,
            statusMessage: "Login is required.",
        });
    }

    const payload = await readBody<TopicBody>(event);
    const boardKey = payload.boardKey?.trim();
    const title = payload.title?.trim();
    const body = payload.body?.trim();

    if (!boardKey || !title || !body) {
        throw createError({
            statusCode: 400,
            statusMessage: "Board, title, and body are required.",
        });
    }

    const board = database.query("SELECT key FROM boards WHERE key = $key").get({ $key: boardKey });

    if (!board) {
        throw createError({
            statusCode: 400,
            statusMessage: "Board was not found.",
        });
    }

    database
        .query(`
            INSERT INTO topics (
                board_key,
                author_user_id,
                title_zh,
                title_en,
                body_zh,
                body_en,
                author_name
            )
            VALUES (
                $boardKey,
                $authorUserId,
                $title,
                $title,
                $body,
                $body,
                $authorName
            )
        `)
        .run({
            $authorName: user.name,
            $authorUserId: user.id,
            $boardKey: boardKey,
            $body: body,
            $title: title,
        });

    return {
        topics: listTopics(),
    };
});
