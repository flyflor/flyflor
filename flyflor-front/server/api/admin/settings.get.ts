import { getCurrentUser } from "../../utils/auth";
import { getSiteSettings, listAnnouncements } from "../../utils/database";

export default defineEventHandler((event) => {
    const user = getCurrentUser(event);

    if (!user?.isAdmin) {
        throw createError({
            statusCode: 403,
            statusMessage: "Admin access is required.",
        });
    }

    return {
        announcements: listAnnouncements(),
        settings: getSiteSettings(),
    };
});
