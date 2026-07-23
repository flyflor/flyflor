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
    /** EN: Kind of side effect the tool run produced. ZH: 本次工具执行产生的副作用种类。 */
    type: 'ask' | 'confirm' | 'read' | 'write' | 'delete' | 'execute';
    /** EN: Optional file path affected by the effect. ZH: 该副作用影响的可选文件路径。 */
    path?: string;
}

/**
 * EN: Normalized tool error payload.
 * ZH: 规范化后的工具错误载荷。
 */
export interface ToolError {
    /** EN: Stable machine-readable error code. ZH: 稳定的机器可读错误码。 */
    code: string;
    /** EN: Human-readable error message. ZH: 面向人的错误消息。 */
    message: string;
    /** EN: Optional structured error detail payload. ZH: 可选的结构化错误详情载荷。 */
    detail?: unknown;
}

/**
 * EN: Standard success/error envelope returned by tools.
 * ZH: 工具统一返回的成功/失败包裹结构。
 */
export type ToolResult<T = unknown> =
    | {
        /** EN: Success marker of the envelope. ZH: 包裹结构的成功标记。 */
        ok: true;
        /** EN: Tool output payload on success. ZH: 成功时的工具输出载荷。 */
        data: T;
        /** EN: Optional side effects produced by the run. ZH: 本次执行产生的可选副作用列表。 */
        effects?: readonly ToolEffect[];
    }
    | {
        /** EN: Failure marker of the envelope. ZH: 包裹结构的失败标记。 */
        ok: false;
        /** EN: Normalized error payload on failure. ZH: 失败时的规范化错误载荷。 */
        error: ToolError;
        /** EN: Optional side effects produced before the failure. ZH: 失败前已产生的可选副作用列表。 */
        effects?: readonly ToolEffect[];
    };
