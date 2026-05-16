import { getSiteSettings, listAnnouncements, listBoards, listTopics } from "../../utils/database";

export default defineEventHandler((event) => {
    const query = getQuery(event);
    const boardKey = typeof query.board === "string" && query.board.trim() ? query.board.trim() : undefined;

    return {
        announcements: listAnnouncements(),
        boards: listBoards(),
        settings: getSiteSettings(),
        topics: listTopics(boardKey),
    };
});
