export const EXECUTION_PROMPT_FILES = [
    'TOOL_PROTOCOL',
    'ENVIRONMENT',
    'EXECUTION',
    'FILE_OPERATIONS',
    'COMMAND_OPERATIONS',
] as const;

export const DEFAULT_DISABLED_TOOL_NAMES = ['plan'] as const;
export const ROUTE_BRIEF_TAG = 'flyflor:route_brief';
export const TOOL_CALL_TAG = 'flyflor:tool';
export const TOOL_RESULT_TAG = 'flyflor:tool_results';
