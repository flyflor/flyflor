/**
 * EN: Declared side-effect risk for one tool surface.
 * ZH: 单个工具面的声明式副作用风险级别。
 */
export type ToolRisk = 'interaction' | 'read' | 'write' | 'destructive' | 'external';

/**
 * EN: One concrete effect produced by a tool run.
 * ZH: 一次工具执行产生的具体效果。
 */
export interface ToolEffect {
    type: 'ask' | 'confirm' | 'task' | 'read' | 'write' | 'delete' | 'execute';
    path?: string;
}

/**
 * EN: Standard success/error envelope returned by tools.
 * ZH: 工具统一返回的成功/失败包裹结构。
 */
export interface ToolResult<T = unknown> {
    ok: true;
    data: T;
    effects?: readonly ToolEffect[];
}
