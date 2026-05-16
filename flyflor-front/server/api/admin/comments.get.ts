import { getCurrentUser } from "../../utils/auth";
import { listAdminComments } from "../../utils/database";

export default defineEventHandler((event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    return {
        comments: listAdminComments(),
    };
});
