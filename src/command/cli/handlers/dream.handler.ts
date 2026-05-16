import { RuntimeModule, type FlyFlor } from "../../../app.ts";

export interface DreamData {
    enabled: boolean;
    busy: boolean;
    users: number;
}

export function fetchDreamData(app: FlyFlor): DreamData {
    const snapshot = app.resolve(RuntimeModule).dreamSnapshot();
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
    return app.resolve(RuntimeModule).runDreamOnce(limit, userId);
}
