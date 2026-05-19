import MarkdownIt from "markdown-it";
import pc from "picocolors";

const markdown = new MarkdownIt({
    breaks: true,
    html: false,
    linkify: true,
});

export function renderMarkdownToAnsi(input: string): string {
    return renderMarkdown(input, true);
}

export function renderMarkdownToPlainText(input: string): string {
    return renderMarkdown(input, false);
}

function renderMarkdown(input: string, ansi: boolean): string {
    const lines: string[] = [];
    const tokens = markdown.parse(input, {});
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (!token) {
            continue;
        }
        if (token.type === "heading_open") {
            const level = Number(token.tag.slice(1));
            const inline = tokens[index + 1];
            const text = inline?.type === "inline" ? renderInline(inline.children ?? [], ansi) : "";
            lines.push(style(`${"#".repeat(level)} ${text}`, ansi, "heading"));
            index += 2;
            continue;
        }
        if (token.type === "paragraph_open") {
            const inline = tokens[index + 1];
            if (inline?.type === "inline") {
                lines.push(renderInline(inline.children ?? [], ansi));
            }
            index += 2;
            continue;
        }
        if (token.type === "fence" || token.type === "code_block") {
            const info = token.info ? `${token.info.trim()}\n` : "";
            lines.push(style(`${info}${token.content.trimEnd()}`, ansi, "code"));
            continue;
        }
        if (token.type === "bullet_list_open" || token.type === "ordered_list_open") {
            const rendered = renderList(tokens, index, token.type === "ordered_list_open", ansi);
            lines.push(...rendered.lines);
            index = rendered.nextIndex;
        }
    }
    return lines.join("\n").trim();
}

function renderInline(tokens: NonNullable<ReturnType<MarkdownIt["parse"]>[number]["children"]>, ansi: boolean): string {
    let output = "";
    const marks: string[] = [];
    for (const token of tokens) {
        if (token.type === "text") {
            output += applyMarks(token.content, marks, ansi);
        } else if (token.type === "code_inline") {
            output += style(token.content, ansi, "code");
        } else if (token.type === "softbreak" || token.type === "hardbreak") {
            output += "\n";
        } else if (token.type === "strong_open" || token.type === "em_open") {
            marks.push(token.type);
        } else if (token.type === "strong_close" || token.type === "em_close") {
            marks.pop();
        } else if (token.type === "link_open") {
            marks.push("link_open");
        } else if (token.type === "link_close") {
            marks.pop();
        }
    }
    return output.trim();
}

function renderList(
    tokens: ReturnType<MarkdownIt["parse"]>,
    start: number,
    ordered: boolean,
    ansi: boolean,
): { lines: string[]; nextIndex: number } {
    const lines: string[] = [];
    let number = 1;
    let index = start + 1;
    while (index < tokens.length) {
        const token = tokens[index];
        if (!token) {
            index += 1;
            continue;
        }
        if (token.type === "bullet_list_close" || token.type === "ordered_list_close") {
            return { lines, nextIndex: index };
        }
        if (token.type === "inline") {
            const marker = ordered ? `${number}.` : "-";
            lines.push(`${style(marker, ansi, "bullet")} ${renderInline(token.children ?? [], ansi)}`);
            number += 1;
        }
        index += 1;
    }
    return { lines, nextIndex: index };
}

function applyMarks(text: string, marks: string[], ansi: boolean): string {
    if (!ansi || marks.length === 0) {
        return text;
    }
    return marks.reduce((current, mark) => {
        if (mark === "strong_open") {
            return pc.bold(current);
        }
        if (mark === "em_open") {
            return pc.italic(current);
        }
        if (mark === "link_open") {
            return pc.cyan(current);
        }
        return current;
    }, text);
}

function style(text: string, ansi: boolean, kind: "bullet" | "code" | "heading"): string {
    if (!ansi) {
        return text;
    }
    if (kind === "heading") {
        return pc.bold(pc.cyan(text));
    }
    if (kind === "code") {
        return pc.gray(text);
    }
    return pc.cyan(text);
}
