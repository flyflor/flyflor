import Table from "cli-table3";
import { FlyFlorTokens, type FlyFlor } from "../../app.ts";
import {
    formatInitResult,
    initializeFlyflorConfig,
    initializeFlyflorGatewayConfig,
    initializeFlyflorModelConfig,
} from "./config.ts";
import { renderChannels, renderDoctor, renderFlyflorBanner, renderStatus, resolveGatewaySnapshot } from "./status.ts";

function renderConfigSummary(app: FlyFlor): string {
    const config = app.resolve(FlyFlorTokens.Config);
    return [
        `Config file: ${config.paths.home}/config.jsonc`,
        `Provider: ${config.model.providerId}`,
        `Model: ${config.model.model}`,
        `API mode: ${config.model.apiMode}`,
        `Gateway: ${config.gateway.host}:${config.gateway.port}`,
        `Allowed channels: ${config.gateway.allowedChannels.join(", ") || "(none)"}`,
    ].join("\n");
}

async function renderMemorySummary(app: FlyFlor): Promise<string> {
    const config = app.resolve(FlyFlorTokens.Config);
    const rows = new Table({ head: ["Field", "Value"], style: { head: [] } });
    rows.push(["Enabled", config.memory.enabled ? "yes" : "no"]);
    rows.push(["Crystal", config.memory.crystal.enabled ? "yes" : "no"]);
    rows.push(["Storage", config.paths.storageDir]);
    rows.push(["Memory dir", config.paths.memoryDir]);
    rows.push(["Prompt dir", config.paths.promptDir]);
    return rows.toString();
}

async function renderBlackboardSummary(app: FlyFlor): Promise<string> {
    const blackboard = app.resolve(FlyFlorTokens.Blackboard);
    const turns = await blackboard.listRecentTurns(5);
    if (turns.length === 0) {
        return "No blackboard turns yet.";
    }
    const table = new Table({
        head: ["Status", "Goal", "Updated"],
        style: { head: [] },
        wordWrap: true,
    });
    for (const turn of turns) {
        table.push([turn.status, turn.goal.slice(0, 80), turn.updatedAt]);
    }
    return table.toString();
}

export {
    formatInitResult,
    initializeFlyflorConfig,
    initializeFlyflorGatewayConfig,
    initializeFlyflorModelConfig,
    renderChannels,
    renderConfigSummary,
    renderDoctor,
    renderFlyflorBanner,
    renderMemorySummary,
    resolveGatewaySnapshot,
    renderBlackboardSummary,
    renderStatus,
};
