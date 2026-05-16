import { listMarketItems } from "../../utils/database";

export default defineEventHandler((event) => {
    const query = getQuery(event);
    const kind = query.kind === "skill" || query.kind === "mcp" ? query.kind : undefined;

    return {
        items: listMarketItems(kind),
    };
});
