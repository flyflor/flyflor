import { createSession, isAdminEmail, verifyPassword } from "../../utils/auth";
import { database, serializeUser } from "../../utils/database";

type LoginBody = {
    email?: string;
    password?: string;
};

export default defineEventHandler(async (event) => {
    const body = await readBody<LoginBody>(event);
    const email = body.email?.trim().toLowerCase();
    const password = body.password ?? "";

    if (!email || !password) {
        throw createError({
            statusCode: 400,
            statusMessage: "Email and password are required.",
        });
    }

    const user = database.query("SELECT * FROM users WHERE email = $email").get({ $email: email }) as Parameters<
        typeof serializeUser
    >[0] | null;

    if (!user?.password_hash || !(await verifyPassword(password, user.password_hash))) {
        throw createError({
            statusCode: 401,
            statusMessage: "Invalid email or password.",
        });
    }

    if (isAdminEmail(user.email) && !user.is_admin) {
        database.query("UPDATE users SET is_admin = 1 WHERE id = $id").run({ $id: user.id });
        user.is_admin = 1;
    }

    createSession(event, user.id);

    return {
        user: serializeUser(user),
    };
});
