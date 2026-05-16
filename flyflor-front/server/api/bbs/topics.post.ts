import { getCurrentUser } from "../../utils/auth";
import { database, listTopics } from "../../utils/database";

type TopicBody = {
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
    const title = payload.title?.trim();
    const body = payload.body?.trim();

    if (!title || !body) {
        throw createError({
            statusCode: 400,
            statusMessage: "Title and body are required.",
        });
    }

    database
        .query(`
            INSERT INTO topics (
                board_key,
                title_zh,
                title_en,
                body_zh,
                body_en,
                author_name
            )
            VALUES (
                'skill',
                $title,
                $title,
                $body,
                $body,
                $authorName
            )
        `)
        .run({
            $authorName: user.name,
            $body: body,
            $title: title,
        });

    return {
        topics: listTopics(),
    };
});
