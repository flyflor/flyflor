import {
    PlanningBlockParser,
    type ParsedPlanningBlocks,
    type PlanningBlockParseContext,
} from "./block.parser.ts";

export { PlanningBlockParser, type ParsedPlanningBlocks, type PlanningBlockParseContext };

const defaultParser = new PlanningBlockParser();

/**
 * Backward-compatible runtime entry for planning/fork/history blocks.
 * New code should inject or own `PlanningBlockParser` directly.
 */
export function parsePlanningBlocks(rawText: string, context: PlanningBlockParseContext): ParsedPlanningBlocks {
    return defaultParser.parse(rawText, context);
}
