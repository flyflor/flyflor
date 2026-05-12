/**
 * ANSI 双缓冲渲染引擎。
 *
 * 职责：
 *   - 管理终端 raw mode / alternate screen / 光标隐藏
 *   - 维护双缓冲：lastBuffer（上一帧）+ curBuffer（当前帧）
 *   - flush() 时逐行比较，只重写差异行
 *   - 键盘事件分发（raw mode stdin 处理）
 *   - SGR 颜色序列生成
 *
 * 零依赖，纯 TypeScript。bun build --compile 兼容。
 */

import type { ToneColor } from "./render.utils.ts";

// ── 键盘事件 ──────────────────────────────────────────────

export interface KeyEvent {
    /** 可打印字符（单个 Unicode code point）；控制组合键则为空字符串 */
    char: string;
    /** 键名：return | escape | tab | backspace | delete | up | down | left | right |
     *        pageup | pagedown | home | end | f1..f12 | space */
    name: string;
    /** Ctrl 修饰 */
    ctrl: boolean;
    /** Shift 修饰 */
    shift: boolean;
    /** Alt / Meta 修饰 */
    meta: boolean;
    /** 原始输入序列（用于调试） */
    raw: string;
}

// ── 鼠标事件 ──────────────────────────────────────────────

export interface MouseEvent {
    /** 0=左键, 1=中键, 2=右键, 64=滚轮上, 65=滚轮下 */
    button: number;
    /** 0-based 列 */
    col: number;
    /** 0-based 行 */
    row: number;
    type: "press" | "release";
    motion: boolean;
}

// ── ANSI 序列工厂 ─────────────────────────────────────────

const CSI = "\x1b[";

function sgr(...codes: number[]): string {
    if (codes.length === 0) return "";
    return `${CSI}${codes.join(";")}m`;
}

const SGR_RESET = sgr(0);
const SGR_BOLD = sgr(1);
const SGR_DIM = sgr(2);

/** hex "#RRGGBB" → ANSI 24-bit 前景色 */
function fgColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${CSI}38;2;${r};${g};${b}m`;
}

/** hex "#RRGGBB" → ANSI 24-bit 背景色 */
function bgColor(hex: string): string {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return `${CSI}48;2;${r};${g};${b}m`;
}

// ── 公开接口 ──────────────────────────────────────────────

export interface ScreenLine {
    text: string;
    color?: ToneColor;
    bold?: boolean;
    dim?: boolean;
}

export class Screen {
    private lastBuffer: string[] = [];
    private curBuffer: string[] = [];
    private rows = 24;
    private cols = 80;
    private closed = false;

    private readonly onKeyCallbacks: Array<(event: KeyEvent) => void> = [];
    private readonly onMouseCallbacks: Array<(event: MouseEvent) => void> = [];
    private readonly onResizeCallbacks: Array<() => void> = [];
    private readonly onCloseCallbacks: Array<() => void> = [];

    /** 进入 alternate screen，隐藏光标，启用 raw mode */
    init(): void {
        // 保存当前终端设置
        process.stdout.write(`${CSI}?1049h`); // enter alternate screen
        process.stdout.write(`${CSI}?25l`);    // hide cursor
        process.stdout.write(`${CSI}2J`);      // clear entire screen
        process.stdout.write(`${CSI}H`);       // cursor to (0,0)
        this.updateSize();

        // 启用 SGR 鼠标
        process.stdout.write(`${CSI}?1000h${CSI}?1006h`);

        // 监听 resize
        process.stdout.on("resize", this.handleResize);

        // 监听 stdin
        process.stdin.setRawMode?.(true);
        process.stdin.resume();
        process.stdin.on("data", this.handleStdinData);

        // resize 初始值
        this.updateSize();
    }

    /** 恢复终端设置 */
    close(): void {
        if (this.closed) return;
        this.closed = true;

        // 禁用鼠标
        process.stdout.write(`${CSI}?1006l${CSI}?1000l`);
        // 恢复光标、退出 alternate screen、清屏
        process.stdout.write(`${CSI}?25h`);
        process.stdout.write(`${CSI}?1049l`);
        process.stdout.write(`${CSI}2J${CSI}H`);

        // 恢复 stdin
        process.stdin.off("data", this.handleStdinData);
        if (process.stdin.isTTY) {
            process.stdin.setRawMode?.(false);
        }

        process.stdout.off("resize", this.handleResize);

        for (const cb of this.onCloseCallbacks) cb();
    }

    /** 获取终端尺寸 */
    getSize(): { rows: number; cols: number } {
        return { rows: this.rows, cols: this.cols };
    }

    /** 注册键盘事件 */
    onKey(cb: (event: KeyEvent) => void): () => void {
        this.onKeyCallbacks.push(cb);
        return () => {
            const idx = this.onKeyCallbacks.indexOf(cb);
            if (idx >= 0) this.onKeyCallbacks.splice(idx, 1);
        };
    }

    /** 注册鼠标事件 */
    onMouse(cb: (event: MouseEvent) => void): () => void {
        this.onMouseCallbacks.push(cb);
        return () => {
            const idx = this.onMouseCallbacks.indexOf(cb);
            if (idx >= 0) this.onMouseCallbacks.splice(idx, 1);
        };
    }

    /** 注册 resize 事件 */
    onResize(cb: () => void): () => void {
        this.onResizeCallbacks.push(cb);
        return () => {
            const idx = this.onResizeCallbacks.indexOf(cb);
            if (idx >= 0) this.onResizeCallbacks.splice(idx, 1);
        };
    }

    /** 注册 close 事件 */
    onClose(cb: () => void): () => void {
        this.onCloseCallbacks.push(cb);
        return () => {
            const idx = this.onCloseCallbacks.indexOf(cb);
            if (idx >= 0) this.onCloseCallbacks.splice(idx, 1);
        };
    }

    /** 写入一行到当前缓冲区，支持颜色/bold/dim 样式 */
    writeLine(
        row: number,
        line: ScreenLine,
        /** 行内偏移列（0-based） */
        column = 0,
    ): void {
        if (this.closed) return;
        if (row < 0 || row >= this.rows) return;

        // 确保缓冲区足够大
        while (this.curBuffer.length <= row) {
            this.curBuffer.push("");
        }
        while (this.lastBuffer.length <= row) {
            this.lastBuffer.push("");
        }

        // 构造带样式的一行文本
        let prefix = "";
        let suffix = SGR_RESET;

        if (line.color) {
            prefix += fgColor(line.color);
        }
        if (line.bold) {
            prefix += SGR_BOLD;
        }
        if (line.dim) {
            prefix += SGR_DIM;
        }

        // 如果需要行内偏移
        const pad = column > 0 ? " ".repeat(column) : "";
        this.curBuffer[row] = `${prefix}${pad}${line.text}${suffix}`;
    }

    /** 渲染整行数组（批量写入） */
    writeLines(lines: ScreenLine[], startRow: number): void {
        for (let i = 0; i < lines.length; i += 1) {
            const line = lines[i];
            if (!line) continue;
            this.writeLine(startRow + i, { text: line.text, color: line.color, bold: line.bold, dim: line.dim });
        }
    }

    /** 清除一行 */
    clearLine(row: number): void {
        if (row >= 0 && row < this.rows) {
            while (this.curBuffer.length <= row) {
                this.curBuffer.push("");
            }
            this.curBuffer[row] = `${SGR_RESET}${" ".repeat(this.cols)}`;
        }
    }

    /** 清除指定行范围 */
    clearRange(startRow: number, endRow: number): void {
        for (let r = startRow; r < endRow && r < this.rows; r += 1) {
            this.clearLine(r);
        }
    }

    /** 刷新渲染：比较 curBuffer 和 lastBuffer，只写差异行 */
    flush(): void {
        if (this.closed) return;

        const maxRows = Math.max(this.lastBuffer.length, this.curBuffer.length);

        for (let row = 0; row < maxRows; row += 1) {
            const cur = this.curBuffer[row] ?? "";
            const last = this.lastBuffer[row] ?? "";

            if (cur !== last) {
                // 移动光标到该行开头
                process.stdout.write(`${CSI}${row + 1};1H`);
                // 写新内容（带清除行尾）
                process.stdout.write(`${cur}${CSI}K`);
                this.lastBuffer[row] = cur;
            }
        }

        // 清除多余行（如果 lastBuffer 比 curBuffer 长）
        for (let row = this.curBuffer.length; row < this.lastBuffer.length; row += 1) {
            process.stdout.write(`${CSI}${row + 1};1H${CSI}K`);
        }
        this.lastBuffer.length = this.curBuffer.length;

        // 重置当前缓冲区（下一帧重新填充）
        this.curBuffer = [];
    }

    // ── 内部处理 ──────────────────────────────────────────

    private updateSize(): void {
        this.rows = process.stdout.rows ?? 24;
        this.cols = process.stdout.columns ?? 80;
    }

    private readonly handleResize = (): void => {
        this.updateSize();
        // resize 后需要重新绘制全部行，清除双缓冲
        this.lastBuffer = [];
        this.curBuffer = [];
        for (const cb of this.onResizeCallbacks) {
            try {
                cb();
            } catch {
                // 吞咽回调错误
            }
        }
    };

    private handleStdinData = (data: Buffer): void => {
        const raw = data.toString("utf-8");

        // 尝试解析 SGR 鼠标序列
        const sgrMatch = raw.match(/^\x1b\[<(\d+);(\d+);(\d+)([Mm])/);
        if (sgrMatch) {
            const cb = parseInt(sgrMatch[1]!, 10);
            const cx = parseInt(sgrMatch[2]!, 10) - 1;
            const cy = parseInt(sgrMatch[3]!, 10) - 1;
            const typeChar = sgrMatch[4]!;
            const button = cb & 0x3f;
            const motion = (cb & 0x20) !== 0;

            const event: MouseEvent = {
                button,
                col: cx,
                row: cy,
                type: typeChar === "M" ? "press" : "release",
                motion,
            };
            for (const cb of this.onMouseCallbacks) {
                try {
                    cb(event);
                } catch {
                    // 吞咽
                }
            }
            return;
        }

        // 解析键盘序列
        const key = this.parseKey(raw);
        if (!key) return;

        for (const cb of this.onKeyCallbacks) {
            try {
                cb(key);
            } catch {
                // 吞咽
            }
        }
    };

    private parseKey(raw: string): KeyEvent | null {
        // Ctrl+C (etx)
        if (raw === "\x03") {
            return { char: "c", name: "c", ctrl: true, shift: false, meta: false, raw };
        }
        // Ctrl+D (eot)
        if (raw === "\x04") {
            return { char: "d", name: "d", ctrl: true, shift: false, meta: false, raw };
        }
        // Ctrl+L
        if (raw === "\x0c") {
            return { char: "l", name: "l", ctrl: true, shift: false, meta: false, raw };
        }
        // Ctrl+U
        if (raw === "\x15") {
            return { char: "u", name: "u", ctrl: true, shift: false, meta: false, raw };
        }
        // Ctrl+W
        if (raw === "\x17") {
            return { char: "w", name: "w", ctrl: true, shift: false, meta: false, raw };
        }
        // Ctrl+B
        if (raw === "\x02") {
            return { char: "b", name: "b", ctrl: true, shift: false, meta: false, raw };
        }
        // Ctrl+T
        if (raw === "\x14") {
            return { char: "t", name: "t", ctrl: true, shift: false, meta: false, raw };
        }
        // Ctrl+S
        if (raw === "\x13") {
            return { char: "s", name: "s", ctrl: true, shift: false, meta: false, raw };
        }
        // Tab
        if (raw === "\t" || raw === "\x1b[Z") {
            return { char: "", name: "tab", ctrl: false, shift: raw === "\x1b[Z", meta: false, raw };
        }
        // Enter
        if (raw === "\r" || raw === "\n") {
            return { char: "", name: "return", ctrl: false, shift: false, meta: false, raw };
        }
        // Escape
        if (raw === "\x1b") {
            return { char: "", name: "escape", ctrl: false, shift: false, meta: false, raw };
        }
        // Backspace
        if (raw === "\x7f" || raw === "\b") {
            return { char: "", name: "backspace", ctrl: false, shift: false, meta: false, raw };
        }
        // Delete
        if (raw === "\x1b[3~") {
            return { char: "", name: "delete", ctrl: false, shift: false, meta: false, raw };
        }
        // 方向键
        if (raw === "\x1b[A") return { char: "", name: "up", ctrl: false, shift: false, meta: false, raw };
        if (raw === "\x1b[B") return { char: "", name: "down", ctrl: false, shift: false, meta: false, raw };
        if (raw === "\x1b[C") return { char: "", name: "right", ctrl: false, shift: false, meta: false, raw };
        if (raw === "\x1b[D") return { char: "", name: "left", ctrl: false, shift: false, meta: false, raw };
        // Home / End
        if (raw === "\x1b[H" || raw === "\x1b[1~") return { char: "", name: "home", ctrl: false, shift: false, meta: false, raw };
        if (raw === "\x1b[F" || raw === "\x1b[4~") return { char: "", name: "end", ctrl: false, shift: false, meta: false, raw };
        // PageUp / PageDown
        if (raw === "\x1b[5~") return { char: "", name: "pageup", ctrl: false, shift: false, meta: false, raw };
        if (raw === "\x1b[6~") return { char: "", name: "pagedown", ctrl: false, shift: false, meta: false, raw };

        // Alt+方向键
        if (raw.match(/^\x1b\x1b\[[ABCD]$/)) {
            const dir = raw.slice(-1)!;
            const map: Record<string, string> = { A: "up", B: "down", C: "right", D: "left" };
            return { char: "", name: map[dir] ?? "", ctrl: false, shift: false, meta: true, raw };
        }

        // 普通可打印字符（包括 CJK 多字节）
        if (raw.length > 0 && raw.charCodeAt(0) >= 32 && !raw.startsWith("\x1b")) {
            return { char: raw, name: raw, ctrl: false, shift: false, meta: false, raw };
        }

        return null;
    }
}
