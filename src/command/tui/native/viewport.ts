/**
 * 对话视口 —— 管理虚拟滚动、ViewLine[] 渲染、滚动条。
 *
 * 职责：
 *   - 根据 scrollOffset 计算可见行范围
 *   - 将可见行通过 Screen 渲染到固定区域
 *   - 绘制滚动条
 *
 * 依赖 screen.ts / render.utils.ts，纯 TypeScript。
 */

import type { Screen, ScreenLine } from "./screen.ts";
import type { ViewLine } from "./render.utils.ts";
import { padDisplayText, truncateDisplayText } from "./render.utils.ts";

export interface ViewportGeometry {
    /** 终端起始行（0-based） */
    topRow: number;
    /** 视口高度（行数） */
    height: number;
    /** 终端起始列（0-based） */
    leftCol: number;
    /** 视口宽度（列数） */
    width: number;
}

export class Viewport {
    private geometry: ViewportGeometry;

    constructor(geometry: ViewportGeometry) {
        this.geometry = geometry;
    }

    /** 更新几何参数（resize 时调用） */
    setGeometry(geometry: ViewportGeometry): void {
        this.geometry = geometry;
    }

    getGeometry(): ViewportGeometry {
        return this.geometry;
    }

    /** 计算滚动条字符数组（每行一个字符） */
    static buildScrollbar(
        totalLines: number,
        viewportHeight: number,
        scrollOffset: number,
    ): string[] {
        const bars: string[] = [];
        if (totalLines <= viewportHeight) {
            for (let i = 0; i < viewportHeight; i += 1) {
                bars.push(" ");
            }
            return bars;
        }

        const thumbHeight = Math.max(1, Math.floor((viewportHeight / totalLines) * viewportHeight));
        const thumbStart = Math.floor((scrollOffset / totalLines) * viewportHeight);

        for (let i = 0; i < viewportHeight; i += 1) {
            if (i >= thumbStart && i < thumbStart + thumbHeight) {
                bars.push("█");
            } else {
                bars.push("│");
            }
        }
        return bars;
    }

    /** 将 ViewLine[] 渲染到 screen */
    render(screen: Screen, allLines: ViewLine[], scrollOffset: number): void {
        const { topRow, height, leftCol, width } = this.geometry;
        const contentWidth = Math.max(1, width - 3); // 留 1 列给边框 + 1 列给滚动条

        const totalLines = allLines.length;
        const clampedOffset = Math.max(0, Math.min(scrollOffset, Math.max(0, totalLines - height)));

        // 绘制顶边
        screen.writeLine(topRow, {
            text: `╭${"─".repeat(Math.max(0, width - 2))}╮`,
            color: "#98A3C7",
            bold: false,
            dim: true,
        });

        // 绘制内容行
        const scrollbar = Viewport.buildScrollbar(totalLines, height, clampedOffset);
        for (let row = 0; row < height; row += 1) {
            const lineIndex = clampedOffset + row;
            const line = allLines[lineIndex];
            const screenRow = topRow + 1 + row;

            // 左边界
            screen.writeLine(screenRow, {
                text: "│",
                color: "#98A3C7",
                bold: false,
                dim: true,
            }, leftCol);

            if (line) {
                // 内容文本（截断到内容宽度）
                const content = padDisplayText(truncateDisplayText(line.text, contentWidth), contentWidth);
                screen.writeLine(screenRow, {
                    text: content,
                    color: line.color ?? "#EAEAF6",
                    bold: line.bold,
                    dim: line.dim,
                }, leftCol + 1);
            } else {
                screen.writeLine(screenRow, {
                    text: " ".repeat(contentWidth),
                    color: "#EAEAF6",
                }, leftCol + 1);
            }

            // 滚动条
            const sbChar = scrollbar[row] ?? " ";
            screen.writeLine(screenRow, {
                text: sbChar,
                color: sbChar === "█" ? "#C78BFF" : "#98A3C7",
                bold: sbChar === "█",
            }, leftCol + 1 + contentWidth);
        }

        // 绘制底边
        screen.writeLine(topRow + height + 1, {
            text: `╰${"─".repeat(Math.max(0, width - 2))}╯`,
            color: "#98A3C7",
            bold: false,
            dim: true,
        });
    }
}
