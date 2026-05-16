import { getCurrentUser } from "../../utils/auth";
import { listAdminTopics } from "../../utils/database";

export default defineEventHandler((event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    return {
        topics: listAdminTopics(),
    };
});
