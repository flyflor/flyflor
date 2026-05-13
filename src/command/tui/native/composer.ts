/**
 * 输入框控制器 —— readline 级别编辑、光标管理、渲染。
 *
 * 职责：
 *   - 管理输入文本 + 光标位置
 *   - 处理键盘编辑操作（字符、backspace、delete、方向键、Ctrl+U/W）
 *   - 生成渲染行
 *
 * 依赖 screen.ts / render.utils.ts，纯 TypeScript。
 */

import type { Screen } from "./screen.ts";
import type { KeyEvent } from "./screen.ts";
import type { Phase, ToneColor } from "./render.utils.ts";
import { PHASE_DEF, THEME, buildInputWindow, stringDisplayWidth, truncateDisplayText, padDisplayText } from "./render.utils.ts";

export interface ComposerState {
    input: string;
    cursor: number;
    notice: { color: ToneColor; text: string } | null;
}

export class Composer {
    private input: string = "";
    private cursor: number = 0;
    private notice: { color: ToneColor; text: string } | null = null;
    private history: string[] = [];
    private historyIndex: number = -1;

    /** 处理按键，返回 true 表示触发提交 */
    handleKey(key: KeyEvent, processing: boolean): "submit" | "exit" | "clear" | "scroll-up" | "scroll-down" | "scroll-pageup" | "scroll-pagedown" | "toggle-all" | "toggle-blackboard" | "toggle-tools" | "toggle-skills" | "ignore" {
        // Ctrl+C → exit / clear
        if (key.ctrl && key.name === "c") {
            return "exit";
        }

        // Ctrl+L → 清屏
        if (key.ctrl && key.name === "l") {
            return "clear";
        }

        // Ctrl+B / Ctrl+T / Ctrl+S → 切换详情面板
        if (key.ctrl && key.name === "b") return "toggle-blackboard";
        if (key.ctrl && key.name === "t") return "toggle-tools";
        if (key.ctrl && key.name === "s") return "toggle-skills";

        // Tab → 切换全部
        if (key.name === "tab") return "toggle-all";

        // Enter → 提交
        if (key.name === "return" && !processing && this.input.trim().length > 0) {
            return "submit";
        }

        // Escape — 不处理
        if (key.name === "escape") return "ignore";

        // Up/Down — 滚动或历史
        if (key.name === "up") {
            if (this.input.length === 0) {
                // 历史回溯
                if (this.history.length > 0) {
                    this.historyIndex = Math.min(this.historyIndex + 1, this.history.length - 1);
                    this.input = this.history[this.history.length - 1 - this.historyIndex] ?? "";
                    this.cursor = this.input.length;
                }
                return "ignore";
            }
            return "scroll-up";
        }
        if (key.name === "down") {
            if (this.input.length === 0) {
                if (this.historyIndex > 0) {
                    this.historyIndex -= 1;
                    this.input = this.history[this.history.length - 1 - this.historyIndex] ?? "";
                    this.cursor = this.input.length;
                } else if (this.historyIndex === 0) {
                    this.historyIndex = -1;
                    this.input = "";
                    this.cursor = 0;
                }
                return "ignore";
            }
            return "scroll-down";
        }

        // PageUp / PageDown
        if (key.name === "pageup") return "scroll-pageup";
        if (key.name === "pagedown") return "scroll-pagedown";

        // 编辑操作（processing 时忽略）
        if (processing) return "ignore";

        // 左/右方向键
        if (key.name === "left") {
            this.cursor = Math.max(0, this.cursor - 1);
            return "ignore";
        }
        if (key.name === "right") {
            this.cursor = Math.min(this.input.length, this.cursor + 1);
            return "ignore";
        }

        // Home / End
        if (key.name === "home") {
            this.cursor = 0;
            return "ignore";
        }
        if (key.name === "end") {
            this.cursor = this.input.length;
            return "ignore";
        }

        // Backspace
        if (key.name === "backspace") {
            if (this.cursor > 0) {
                this.input = this.input.slice(0, this.cursor - 1) + this.input.slice(this.cursor);
                this.cursor -= 1;
            }
            return "ignore";
        }

        // Delete
        if (key.name === "delete") {
            if (this.cursor < this.input.length) {
                this.input = this.input.slice(0, this.cursor) + this.input.slice(this.cursor + 1);
            }
            return "ignore";
        }

        // Ctrl+U → 清空
        if (key.ctrl && key.name === "u") {
            this.input = "";
            this.cursor = 0;
            return "ignore";
        }

        // Ctrl+W → 删除前一个单词
        if (key.ctrl && key.name === "w") {
            const prefix = this.input.slice(0, this.cursor);
            const suffix = this.input.slice(this.cursor);
            const boundary = prefix.trimEnd().lastIndexOf(" ");
            const head = boundary >= 0 ? prefix.slice(0, boundary + 1) : "";
            this.input = head + suffix;
            this.cursor = head.length;
            return "ignore";
        }

        // 可打印字符
        if (key.char.length > 0) {
            this.input =
                this.input.slice(0, this.cursor) + key.char + this.input.slice(this.cursor);
            this.cursor += key.char.length;
            return "ignore";
        }

        return "ignore";
    }

    /** 提交：记录历史，清空输入，返回文本 */
    submit(): string {
        const text = this.input.trim();
        if (text.length > 0) {
            this.history.push(text);
            // 限制历史长度
            if (this.history.length > 200) {
                this.history = this.history.slice(-200);
            }
        }
        this.input = "";
        this.cursor = 0;
        this.historyIndex = -1;
        this.notice = null;
        return text;
    }

    /** 设置通知 */
    setNotice(notice: { color: ToneColor; text: string } | null): void {
        this.notice = notice;
    }

    /** 清空输入状态（不清历史） */
    clearInput(): void {
        this.input = "";
        this.cursor = 0;
        this.notice = null;
    }

    /** 获取当前状态快照 */
    getState(): ComposerState {
        return { input: this.input, cursor: this.cursor, notice: this.notice };
    }

    /** 渲染输入框到底部行 */
    render(
        screen: Screen,
        row: number,
        width: number,
        phase: Phase,
        processing: boolean,
        agentName: string,
    ): void {
        const phaseDef = PHASE_DEF[phase];
        const phaseLabel = processing ? phaseDef.label : "READY";
        const phaseColor = processing ? phaseDef.color : THEME.muted;

        // 计算可用输入宽度
        const labelWidth = stringDisplayWidth(`[${phaseLabel}]`) + 2;
        const promptWidth = stringDisplayWidth("› ") + 1;
        const borderWidth = 4; // ╭ ╮ ╰ ╯ + 边框线
        const inputWidth = Math.max(10, width - borderWidth - promptWidth - labelWidth);

        const inputWindow = buildInputWindow(this.input, this.cursor, inputWidth);

        // 构建输入行文本
        const displayInput = this.input.length === 0
            ? `Type a message to ${agentName}…`
            : `${inputWindow.clippedLeft ? "…" : ""}${inputWindow.before}${processing ? "" : "▎"}${inputWindow.after}${inputWindow.clippedRight ? "…" : ""}`;

        const hintText = this.notice?.text ??
            "Enter send · Ctrl+U clear line · Ctrl+W delete word · Ctrl+C clear / confirm exit · ↑↓ PgUp PgDn scroll";

        // 顶边
        screen.writeLine(row, {
            text: `╭${"─".repeat(Math.max(0, width - 2))}╮`,
            color: THEME.cyanSoft,
        });

        // 输入行
        const line1Content = padDisplayText(
            truncateDisplayText(`› ${displayInput}`, width - 2 - labelWidth),
            width - 2 - labelWidth,
        );
        screen.writeLine(row + 1, {
            text: `│${line1Content} [${phaseLabel}]│`,
            color: this.input.length === 0 ? THEME.muted : THEME.silver,
        });

        // 提示行
        const hintColor = this.notice?.color ?? THEME.muted;
        screen.writeLine(row + 2, {
            text: `│${padDisplayText(truncateDisplayText(hintText, width - 2), width - 2)}│`,
            color: hintColor,
            dim: true,
        });

        // 底边
        screen.writeLine(row + 3, {
            text: `╰${"─".repeat(Math.max(0, width - 2))}╯`,
            color: THEME.cyanSoft,
        });
    }
}
