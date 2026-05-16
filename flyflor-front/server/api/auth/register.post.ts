import { createSession, hashPassword, isAdminEmail } from "../../utils/auth";
import { database, serializeUser } from "../../utils/database";

type RegisterBody = {
    email?: string;
    name?: string;
    password?: string;
};

export default defineEventHandler(async (event) => {
    const body = await readBody<RegisterBody>(event);
    const email = body.email?.trim().toLowerCase();
    const name = body.name?.trim();
    const password = body.password ?? "";

    if (!email || !name || password.length < 8) {
        throw createError({
            statusCode: 400,
            statusMessage: "Name, email, and an 8 character password are required.",
        });
    }

    const existing = database.query("SELECT id FROM users WHERE email = $email").get({ $email: email });

    if (existing) {
        throw createError({
            statusCode: 409,
            statusMessage: "This email is already registered.",
        });
    }

    const passwordHash = await hashPassword(password);
    const userCount = database.query("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    const result = database
        .query("INSERT INTO users (email, name, password_hash, is_admin) VALUES ($email, $name, $passwordHash, $isAdmin)")
        .run({
            $email: email,
            $isAdmin: userCount.count === 0 || isAdminEmail(email) ? 1 : 0,
            $name: name,
            $passwordHash: passwordHash,
        });

    const user = database.query("SELECT * FROM users WHERE id = $id").get({ $id: result.lastInsertRowid }) as Parameters<
        typeof serializeUser
    >[0];

    createSession(event, user.id);

    return {
        user: serializeUser(user),
    };
});
