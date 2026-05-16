import { getCurrentUser } from "../../utils/auth";
import { database, listBoardsWithTopicCounts } from "../../utils/database";

type BoardAction = "create" | "delete" | "update";

type BoardBody = {
    action?: BoardAction;
    descriptionEn?: string;
    descriptionZh?: string;
    id?: number;
    key?: string;
    nameEn?: string;
    nameZh?: string;
};

const boardKeyPattern = /^[a-z][a-z0-9.]{1,30}$/;

export default defineEventHandler(async (event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    const body = await readBody<BoardBody>(event);

    if (body.action === "create") {
        createBoard(body);
    } else if (body.action === "update") {
        updateBoard(body);
    } else if (body.action === "delete") {
        deleteBoard(body);
    } else {
        throw createError({
            statusCode: 400,
            statusMessage: "Unsupported board action.",
        });
    }

    return {
        boards: listBoardsWithTopicCounts(),
    };
});

function createBoard(body: BoardBody): void {
    const key = body.key?.trim().toLowerCase();
    const nameZh = body.nameZh?.trim();
    const nameEn = body.nameEn?.trim();
    const descriptionZh = body.descriptionZh?.trim();
    const descriptionEn = body.descriptionEn?.trim();

    if (!key || !boardKeyPattern.test(key) || !nameZh || !nameEn || !descriptionZh || !descriptionEn) {
        throw createError({
            statusCode: 400,
            statusMessage: "Board key, names, and descriptions are required.",
        });
    }

    database
        .query(`
            INSERT INTO boards (
                key,
                name_zh,
                name_en,
                description_zh,
                description_en
            )
            VALUES (
                $key,
                $nameZh,
                $nameEn,
                $descriptionZh,
                $descriptionEn
            )
        `)
        .run({
            $descriptionEn: descriptionEn,
            $descriptionZh: descriptionZh,
            $key: key,
            $nameEn: nameEn,
            $nameZh: nameZh,
        });
}

function updateBoard(body: BoardBody): void {
    const id = Number(body.id);
    const nameZh = body.nameZh?.trim();
    const nameEn = body.nameEn?.trim();
    const descriptionZh = body.descriptionZh?.trim();
    const descriptionEn = body.descriptionEn?.trim();

    if (!Number.isInteger(id) || id <= 0 || !nameZh || !nameEn || !descriptionZh || !descriptionEn) {
        throw createError({
            statusCode: 400,
            statusMessage: "Board id, names, and descriptions are required.",
        });
    }

    database
        .query(`
            UPDATE boards
            SET
                name_zh = $nameZh,
                name_en = $nameEn,
                description_zh = $descriptionZh,
                description_en = $descriptionEn
            WHERE id = $id
        `)
        .run({
            $descriptionEn: descriptionEn,
            $descriptionZh: descriptionZh,
            $id: id,
            $nameEn: nameEn,
            $nameZh: nameZh,
        });
}

function deleteBoard(body: BoardBody): void {
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
        throw createError({
            statusCode: 400,
            statusMessage: "Board id is required.",
        });
    }

    const board = database
        .query(`
            SELECT
                boards.id,
                COUNT(topics.id) AS topic_count
            FROM boards
            LEFT JOIN topics ON topics.board_key = boards.key
            WHERE boards.id = $id
            GROUP BY boards.id
        `)
        .get({ $id: id }) as { id: number; topic_count: number } | null;

    if (!board) {
        throw createError({
            statusCode: 404,
            statusMessage: "Board was not found.",
        });
    }

    if (board.topic_count > 0) {
        throw createError({
            statusCode: 409,
            statusMessage: "Only empty boards can be deleted.",
        });
    }

    database.query("DELETE FROM boards WHERE id = $id").run({ $id: id });
}
