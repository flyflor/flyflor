import { BoxRenderable, type ScrollBoxRenderable } from "@opentui/core";

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
