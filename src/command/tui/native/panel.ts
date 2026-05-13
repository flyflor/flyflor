/**
 * 侧边栏面板 —— 渲染 inspector（当前回合状态、skills、tools、hotkeys）。
 *
 * 依赖 screen.ts / render.utils.ts，纯 TypeScript。
 */

import type { Screen } from "./screen.ts";
import type { ViewLine, Phase } from "./render.utils.ts";
import { buildInspectorLines, THEME, padDisplayText, truncateDisplayText } from "./render.utils.ts";
import type { Turn } from "./render.utils.ts";

export class Panel {
    /** 将 inspector ViewLine[] 渲染到侧边栏 */
    render(
        screen: Screen,
        lines: ViewLine[],
        topRow: number,
        height: number,
        width: number,
    ): void {
        const contentWidth = Math.max(1, width - 2);

        // 顶边
        screen.writeLine(topRow, {
            text: `╭${"─".repeat(Math.max(0, width - 2))}╮`,
            color: THEME.violet,
        });

        // 内容行
        for (let row = 0; row < height; row += 1) {
            const line = lines[row];
            const screenRow = topRow + 1 + row;

            if (line) {
                const content = padDisplayText(truncateDisplayText(line.text, contentWidth), contentWidth);
                screen.writeLine(screenRow, {
                    text: `│${content}│`,
                    color: line.color ?? THEME.silver,
                    bold: line.bold,
                    dim: line.dim,
                });
            } else {
                screen.writeLine(screenRow, {
                    text: `│${" ".repeat(contentWidth)}│`,
                    color: THEME.muted,
                });
            }
        }

        // 底边
        screen.writeLine(topRow + height + 1, {
            text: `╰${"─".repeat(Math.max(0, width - 2))}╯`,
            color: THEME.violet,
        });
    }
}
