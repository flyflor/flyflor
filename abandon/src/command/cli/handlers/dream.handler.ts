import type { FlyFlor } from "../../../app.ts";
import { commandRuntime } from "../../runtime.adapter.ts";

export interface DreamData {
    enabled: boolean;
    busy: boolean;
    users: number;
}

export function fetchDreamData(app: FlyFlor): DreamData {
    const snapshot = commandRuntime(app).dreamSnapshot();
    return {
        enabled: snapshot.dreamEnabled,
        busy: snapshot.dreamBusy,
        users: snapshot.users,
    };
}

export async function runDreamPass(app: FlyFlor, limit?: number, userId?: string): Promise<{
    users: number;
    driftRepaired: number;
    recallReinforced: number;
    contradictionsFlagged: number;
    skipped: number;
}> {
    return commandRuntime(app).runDreamOnce(limit, userId);
}
