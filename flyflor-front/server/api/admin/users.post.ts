import { getCurrentUser } from "../../utils/auth";
import { countAdminUsers, database, listAdminUsers } from "../../utils/database";

type UserAction = "delete" | "update";

type UserBody = {
    action?: UserAction;
    id?: number;
    isAdmin?: boolean;
    name?: string;
};

export default defineEventHandler(async (event) => {
    const admin = getCurrentUser(event);

    if (!admin?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    const body = await readBody<UserBody>(event);

    if (body.action === "update") {
        updateUser(body, admin.id);
    } else if (body.action === "delete") {
        deleteUser(body, admin.id);
    } else {
        throw createError({
            statusCode: 400,
            statusMessage: "Unsupported user action.",
        });
    }

    return {
        users: listAdminUsers(),
    };
});

function updateUser(body: UserBody, currentUserId: number): void {
    const id = Number(body.id);
    const name = body.name?.trim();

    if (!Number.isInteger(id) || id <= 0 || !name) {
        throw createError({
            statusCode: 400,
            statusMessage: "User id and name are required.",
        });
    }

    const current = database.query("SELECT id, is_admin FROM users WHERE id = $id").get({ $id: id }) as {
        id: number;
        is_admin: number;
    } | null;

    if (!current) {
        throw createError({
            statusCode: 404,
            statusMessage: "User was not found.",
        });
    }

    const nextIsAdmin = body.isAdmin ? 1 : 0;

    if (id === currentUserId && nextIsAdmin === 0) {
        throw createError({
            statusCode: 409,
            statusMessage: "You cannot remove your own admin access.",
        });
    }

    if (current.is_admin === 1 && nextIsAdmin === 0 && countAdminUsers() <= 1) {
        throw createError({
            statusCode: 409,
            statusMessage: "At least one admin account is required.",
        });
    }

    database
        .query(`
            UPDATE users
            SET
                name = $name,
                is_admin = $isAdmin
            WHERE id = $id
        `)
        .run({
            $id: id,
            $isAdmin: nextIsAdmin,
            $name: name,
        });
}

function deleteUser(body: UserBody, currentUserId: number): void {
    const id = Number(body.id);

    if (!Number.isInteger(id) || id <= 0) {
        throw createError({
            statusCode: 400,
            statusMessage: "User id is required.",
        });
    }

    if (id === currentUserId) {
        throw createError({
            statusCode: 409,
            statusMessage: "You cannot delete your own account.",
        });
    }

    const current = database.query("SELECT id, is_admin FROM users WHERE id = $id").get({ $id: id }) as {
        id: number;
        is_admin: number;
    } | null;

    if (!current) {
        throw createError({
            statusCode: 404,
            statusMessage: "User was not found.",
        });
    }

    if (current.is_admin === 1 && countAdminUsers() <= 1) {
        throw createError({
            statusCode: 409,
            statusMessage: "At least one admin account is required.",
        });
    }

    database.query("DELETE FROM users WHERE id = $id").run({ $id: id });
}
