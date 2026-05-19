interface FiletypeParserOptions {
    filetype: string;
    aliases?: string[];
    wasm: string;
    queries: {
        highlights: string[];
        injections?: string[];
    };
    injectionMapping?: {
        nodeTypes: {
            inline: string;
            pipe_table_cell: string;
        };
        infoStringMap: Record<string, string>;
    };
}

type FileRef = { default: string };

export async function loadChatParsers(): Promise<FiletypeParserOptions[]> {
    const assets = (await Promise.all([
        import("../../../../node_modules/@opentui/core/assets/javascript/highlights.scm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/javascript/tree-sitter-javascript.wasm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/typescript/highlights.scm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/typescript/tree-sitter-typescript.wasm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/markdown/highlights.scm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/markdown/tree-sitter-markdown.wasm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/markdown/injections.scm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/markdown_inline/highlights.scm", {
            with: { type: "file" },
        }),
        import("../../../../node_modules/@opentui/core/assets/markdown_inline/tree-sitter-markdown_inline.wasm", {
            with: { type: "file" },
        }),
    ])) as FileRef[];

    const javascriptHighlights = assets[0]!.default;
    const javascriptWasm = assets[1]!.default;
    const typescriptHighlights = assets[2]!.default;
    const typescriptWasm = assets[3]!.default;
    const markdownHighlights = assets[4]!.default;
    const markdownWasm = assets[5]!.default;
    const markdownInjections = assets[6]!.default;
    const markdownInlineHighlights = assets[7]!.default;
    const markdownInlineWasm = assets[8]!.default;

    return [
        {
            aliases: ["javascriptreact"],
            filetype: "javascript",
            queries: {
                highlights: [javascriptHighlights],
            },
            wasm: javascriptWasm,
        },
        {
            aliases: ["typescriptreact"],
            filetype: "typescript",
            queries: {
                highlights: [typescriptHighlights],
            },
            wasm: typescriptWasm,
        },
        {
            filetype: "markdown",
            injectionMapping: {
                infoStringMap: {
                    javascript: "javascript",
                    javascriptreact: "javascriptreact",
                    js: "javascript",
                    jsx: "javascriptreact",
                    markdown: "markdown",
                    md: "markdown",
                    ts: "typescript",
                    tsx: "typescriptreact",
                    typescript: "typescript",
                    typescriptreact: "typescriptreact",
                },
                nodeTypes: {
                    inline: "markdown_inline",
                    pipe_table_cell: "markdown_inline",
                },
            },
            queries: {
                highlights: [markdownHighlights],
                injections: [markdownInjections],
            },
            wasm: markdownWasm,
        },
        {
            filetype: "markdown_inline",
            queries: {
                highlights: [markdownInlineHighlights],
            },
            wasm: markdownInlineWasm,
        },
    ];
}
