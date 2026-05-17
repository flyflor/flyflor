/**
 * Streaming visibility filter for model-emitted internal protocol blocks.
 *
 * Runtime surfaces may stream normal text, but internal blocks such as
 * MemoryActions and McpCalls are machine protocol, not user-facing copy. This
 * filter hides those blocks incrementally so TUI/channel renderers receive only
 * final visible text while the runtime still parses the raw model output.
 */

import { structuredBlock, StructuredBlockProtocol } from "../../../protocol/index.ts";

const HIDDEN_PROTOCOL_BLOCKS = [
    structuredBlock(StructuredBlockProtocol.MemoryActions),
    structuredBlock(StructuredBlockProtocol.McpCalls),
] as const;

const HIDDEN_PROTOCOL_MAX_OPEN_LENGTH = Math.max(...HIDDEN_PROTOCOL_BLOCKS.map((block) => block.open.length));

export class ProtocolVisibilityFilter {
    private buffer = "";
    private hiddenClose: string | undefined;

    public push(chunk: string): string {
        this.buffer += chunk;
        let output = "";
        while (this.buffer) {
            if (this.hiddenClose) {
                const closeIndex = this.buffer.indexOf(this.hiddenClose);
                if (closeIndex < 0) {
                    this.buffer = keepSuffix(this.buffer, this.hiddenClose);
                    return output;
                }
                this.buffer = this.buffer.slice(closeIndex + this.hiddenClose.length);
                this.hiddenClose = undefined;
                continue;
            }

            const nextBlock = findHiddenProtocolBlock(this.buffer);
            if (nextBlock) {
                output += this.buffer.slice(0, nextBlock.index);
                this.buffer = this.buffer.slice(nextBlock.index + nextBlock.open.length);
                this.hiddenClose = nextBlock.close;
                continue;
            }

            const emitLength = Math.max(0, this.buffer.length - HIDDEN_PROTOCOL_MAX_OPEN_LENGTH + 1);
            if (emitLength === 0) {
                return output;
            }
            output += this.buffer.slice(0, emitLength);
            this.buffer = this.buffer.slice(emitLength);
        }
        return output;
    }

    public finish(): string {
        const output = this.hiddenClose ? "" : this.buffer;
        this.buffer = "";
        this.hiddenClose = undefined;
        return output;
    }
}

export function filterVisibleProtocolText(text: string): string {
    const filter = new ProtocolVisibilityFilter();
    return `${filter.push(text)}${filter.finish()}`;
}

function findHiddenProtocolBlock(buffer: string): { close: string; index: number; open: string } | undefined {
    let found: { close: string; index: number; open: string } | undefined;
    for (const block of HIDDEN_PROTOCOL_BLOCKS) {
        const index = buffer.indexOf(block.open);
        if (index < 0) {
            continue;
        }
        if (!found || index < found.index) {
            found = { close: block.close, index, open: block.open };
        }
    }
    return found;
}

function keepSuffix(value: string, token: string): string {
    return value.slice(Math.max(0, value.length - token.length + 1));
}
