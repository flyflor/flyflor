import { BoxRenderable, TextRenderable, type CliRenderer, type RGBA, type ScrollBoxRenderable } from "@opentui/core";

export interface VirtualScrollBar {
    rail: BoxRenderable;
    sync: () => void;
}

export interface VirtualScrollBarOptions {
    thumbColor: RGBA;
    trackColor: RGBA;
}

/**
 * TUI chrome composition for scrollbox surfaces that keep OpenTUI's scroll
 * mechanics but remove the built-in visual bars. This is UI-only state: it
 * must not mutate message/history data or implement custom wheel handling.
 */
export function useDetachedScrollBars(scrollBox: ScrollBoxRenderable): void {
    scrollBox.verticalScrollBar.visible = false;
    scrollBox.verticalScrollBar.width = 0;
    scrollBox.verticalScrollBar.slider.visible = false;
    scrollBox.verticalScrollBar.startArrow.visible = false;
    scrollBox.verticalScrollBar.endArrow.visible = false;
    scrollBox.horizontalScrollBar.visible = false;
    scrollBox.horizontalScrollBar.height = 0;
    scrollBox.horizontalScrollBar.slider.visible = false;
    scrollBox.horizontalScrollBar.startArrow.visible = false;
    scrollBox.horizontalScrollBar.endArrow.visible = false;

    // OpenTUI still owns the viewport/offset state. Removing these renderables
    // prevents a second visual scrollbar from being painted over Flyflor chrome.
    BoxRenderable.prototype.remove.call(scrollBox, scrollBox.verticalScrollBar.id);
    scrollBox.wrapper.remove(scrollBox.horizontalScrollBar.id);
}

export function createVirtualScrollBar(
    renderer: CliRenderer,
    scrollBox: ScrollBoxRenderable,
    options: VirtualScrollBarOptions,
): VirtualScrollBar {
    const lines: TextRenderable[] = [];
    let controller: VirtualScrollBar | undefined;
    const rail = new BoxRenderable(renderer, {
        flexDirection: "column",
        flexShrink: 0,
        width: 2,
        onMouseScroll: (event) => {
            const direction = event.scroll?.direction;
            if (direction === "up") {
                scrollBox.scrollBy({ x: 0, y: -3 });
            } else if (direction === "down") {
                scrollBox.scrollBy({ x: 0, y: 3 });
            }
            controller?.sync();
            event.preventDefault();
            event.stopPropagation();
        },
        onSizeChange: () => {
            controller?.sync();
        },
    });

    const sync = () => {
        const height = Math.max(0, rail.height);
        while (lines.length > height) {
            const stale = lines.pop()!;
            rail.remove(stale.id);
        }
        while (lines.length < height) {
            const line = new TextRenderable(renderer, {
                content: " •",
                fg: options.trackColor,
                height: 1,
                selectable: false,
                width: 2,
            });
            lines.push(line);
            rail.add(line);
        }
        if (height === 0) return;

        const scrollAreaHeight = Math.max(0, height - 2);
        const viewportHeight = Math.max(1, scrollBox.viewport.height);
        const scrollHeight = Math.max(viewportHeight, scrollBox.scrollHeight);
        const overflow = Math.max(0, scrollHeight - viewportHeight);
        const thumbHeight = overflow === 0
            ? 0
            : Math.max(1, Math.round((viewportHeight / scrollHeight) * scrollAreaHeight));
        const maxThumbTop = Math.max(0, scrollAreaHeight - thumbHeight);
        const thumbTop = overflow === 0 ? 0 : Math.round((scrollBox.scrollTop / overflow) * maxThumbTop);

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index]!;
            if (index === 0) {
                line.content = "▲ ";
                line.fg = options.trackColor;
                continue;
            }
            if (index === lines.length - 1) {
                line.content = "▼ ";
                line.fg = options.trackColor;
                continue;
            }
            const railIndex = index - 1;
            const inThumb = overflow > 0 && railIndex >= thumbTop && railIndex < thumbTop + thumbHeight;
            line.content = inThumb ? "██" : " •";
            line.fg = inThumb ? options.thumbColor : options.trackColor;
        }
    };

    rail.onLifecyclePass = sync;
    controller = { rail, sync };
    return controller;
}
