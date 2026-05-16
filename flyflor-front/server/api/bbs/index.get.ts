import { getSiteSettings, listAnnouncements, listTopics } from "../../utils/database";

export default defineEventHandler(() => {
    return {
        announcements: listAnnouncements(),
        settings: getSiteSettings(),
        topics: listTopics(),
    };
});
