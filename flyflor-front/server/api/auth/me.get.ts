import { getCurrentUser } from "../../utils/auth";

export default defineEventHandler((event) => {
    return {
        user: getCurrentUser(event),
    };
});
