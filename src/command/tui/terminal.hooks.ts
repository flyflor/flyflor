import { useCallback, useEffect, useRef, useState } from "react";

let alternateScreenActive = false;

/**
 * Enables the alternate screen buffer so the TUI takes over the full terminal.
 * Prevents terminal scrollback / native scrollbar from appearing.
 *
 * The first call writes escape sequences synchronously (before Ink renders),
 * avoiding a visible flash from main screen → alternate screen transition.
 * Subsequent calls are no-ops. On unmount, restores the main buffer.
 */
export function useAlternateScreen(): void {
    if (!alternateScreenActive) {
        alternateScreenActive = true;
        // Hide cursor, enter alternate screen, clear — must happen before Ink's first render
        process.stdout.write("\x1b[?25l\x1b[?1049h\x1b[2J\x1b[H");
    }

    useEffect(() => {
        return () => {
            alternateScreenActive = false;
            // Exit alternate screen, show cursor, clear
            process.stdout.write("\x1b[?1049l\x1b[?25h\x1b[2J\x1b[H");
        };
    }, []);
}

export interface TerminalMouseEvent {
    /** 0=left, 1=middle, 2=right, 64=wheel-up, 65=wheel-down */
    button: number;
    col: number;
    row: number;
    type: "press" | "release";
    motion: boolean;
}

/**
 * Enables SGR extended mouse tracking and parses mouse events from stdin.
 * Wheel events (button 64/65) are always forwarded.
 * Click/drag events are forwarded with (row, col) coordinates (0-based).
 *
 * Coexists with Ink's useInput: mouse SGR sequences start with `\x1b[<`
 * which Ink's keyboard parser ignores.
 */
export function useTerminalMouse(
    onEvent: (event: TerminalMouseEvent) => void,
    options: { enabled?: boolean } = {},
): void {
    const onEventRef = useRef(onEvent);
    onEventRef.current = onEvent;

    const enabled = options.enabled !== false;

    useEffect(() => {
        if (!enabled) return;

        process.stdout.write("\x1b[?1000h\x1b[?1006h");

        let buffer = "";
        const SGR_RE = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;

        const onData = (data: Buffer): void => {
            buffer += data.toString("utf-8");

            let match: RegExpExecArray | null;
            while ((match = SGR_RE.exec(buffer)) !== null) {
                const cb = parseInt(match[1]!, 10);
                const cx = parseInt(match[2]!, 10) - 1; // 0-based
                const cy = parseInt(match[3]!, 10) - 1; // 0-based
                const typeChar = match[4]; // 'M' = press, 'm' = release
                buffer = buffer.slice(match[0].length);

                const button = cb & 0x3f;
                const motion = (cb & 0x20) !== 0;

                // Wheel events: cb includes 64; always forward
                if (button === 64 || button === 65) {
                    onEventRef.current({
                        button,
                        col: cx,
                        row: cy,
                        type: "press",
                        motion: false,
                    });
                    continue;
                }

                // Regular mouse events
                onEventRef.current({
                    button,
                    col: cx,
                    row: cy,
                    type: typeChar === "M" ? "press" : "release",
                    motion,
                });
            }

            // Keep only tail for partial sequence
            if (buffer.length > 0) {
                buffer = buffer.slice(-32);
            }
        };

        process.stdin.on("data", onData);

        return () => {
            process.stdin.off("data", onData);
            process.stdout.write("\x1b[?1006l\x1b[?1000l");
        };
    }, [enabled]);
}

/**
 * Maps mouse wheel events and scrollbar drag interactions to scroll state changes.
 * Wheel events scroll ±3 lines anywhere in the viewport area.
 * Left-click on the scrollbar column jumps to proportional position; left-drag scrubs.
 */
export function useTerminalScroll(
    viewportTopRow: number,
    viewportHeight: number,
    /** Terminal column where the viewport right border (and scrollbar) sits. */
    viewportRightCol: number,
    maxScroll: number,
    setScrollOffset: (value: number | ((prev: number) => number)) => void,
): {
    /** Call this from the mouse event handler to apply scrolling */
    handleMouse: (event: TerminalMouseEvent) => void;
    /** Whether the user is currently dragging the scrollbar */
    dragging: boolean;
} {
    const maxScrollRef = useRef(maxScroll);
    maxScrollRef.current = maxScroll;

    const viewportRightColRef = useRef(viewportRightCol);
    viewportRightColRef.current = viewportRightCol;

    const [dragging, setDragging] = useState(false);
    const draggingRef = useRef(false);
    const dragStartRowRef = useRef(0);
    const dragStartOffsetRef = useRef(0);

    const inViewportRows = useCallback(
        (row: number): boolean => row >= viewportTopRow && row < viewportTopRow + viewportHeight,
        [viewportTopRow, viewportHeight],
    );

    const nearScrollbar = useCallback(
        (col: number): boolean => {
            // Scrollbar sits within the rightmost 3 terminal columns.
            const right = viewportRightColRef.current;
            return col >= right - 2 && col <= right;
        },
        [],
    );

    const handleMouse = useCallback(
        (event: TerminalMouseEvent) => {
            if (!inViewportRows(event.row)) return;

            // Wheel events: scroll up (64) / down (65) — works anywhere in the viewport
            if (event.button === 64 || event.button === 65) {
                const direction = event.button === 64 ? 1 : -1;
                const linesPerWheel = 3;
                setScrollOffset((prev) => {
                    const next = prev + direction * linesPerWheel;
                    return Math.max(0, Math.min(next, maxScrollRef.current));
                });
                return;
            }

            // Left button: scrollbar interaction only when clicking near the right edge
            if (event.button === 0) {
                if (!nearScrollbar(event.col)) return;

                const total = maxScrollRef.current + viewportHeight;
                if (total <= viewportHeight) return;

                if (event.type === "press") {
                    const relativeRow = event.row - viewportTopRow;
                    const start = Math.round((relativeRow / Math.max(1, viewportHeight - 1)) * maxScrollRef.current);
                    setScrollOffset(Math.max(0, Math.min(start, maxScrollRef.current)));

                    draggingRef.current = true;
                    setDragging(true);
                    dragStartRowRef.current = event.row;
                    dragStartOffsetRef.current = Math.max(0, Math.min(start, maxScrollRef.current));
                } else {
                    draggingRef.current = false;
                    setDragging(false);
                }
                return;
            }

            // Motion while left button held → drag scrollbar
            if (event.motion && draggingRef.current) {
                const total = maxScrollRef.current + viewportHeight;
                if (total <= viewportHeight) return;

                const deltaRow = event.row - dragStartRowRef.current;
                const scrollPerRow = total / Math.max(1, viewportHeight);
                const newOffset = dragStartOffsetRef.current + Math.round(deltaRow * scrollPerRow);
                setScrollOffset(Math.max(0, Math.min(newOffset, maxScrollRef.current)));
            }
        },
        [inViewportRows, nearScrollbar, viewportHeight, setScrollOffset],
    );

    return { handleMouse, dragging };
}
