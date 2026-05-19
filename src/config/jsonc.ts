/**
 * Shared JSONC parsing for Flyflor runtime configuration files.
 *
 * Config, MCP, plugin, sandbox and user-tool manifests all promise JSONC
 * compatibility. Keeping the comment stripping in config avoids lower layers
 * importing each other's manifest readers just to parse the file format.
 */
export class JsoncParser {
    public parse(input: string): unknown {
        return JSON.parse(this.strip(input));
    }

    public strip(input: string): string {
        let output = "";
        let inString = false;
        let quote = "";
        let escaped = false;

        for (let index = 0; index < input.length; index += 1) {
            const char = input[index]!;
            const next = input[index + 1];

            if (inString) {
                output += char;
                if (escaped) {
                    escaped = false;
                } else if (char === "\\") {
                    escaped = true;
                } else if (char === quote) {
                    inString = false;
                    quote = "";
                }
                continue;
            }

            if (char === "\"" || char === "'") {
                inString = true;
                quote = char;
                output += char;
                continue;
            }

            if (char === "/" && next === "/") {
                while (index < input.length && input[index] !== "\n") {
                    index += 1;
                }
                output += "\n";
                continue;
            }

            if (char === "/" && next === "*") {
                index += 2;
                while (index < input.length && !(input[index] === "*" && input[index + 1] === "/")) {
                    index += 1;
                }
                index += 1;
                continue;
            }

            output += char;
        }

        return output.replace(/,\s*([}\]])/g, "$1");
    }
}

export function parseJsonc(input: string): unknown {
    return new JsoncParser().parse(input);
}

export function stripJsonc(input: string): string {
    return new JsoncParser().strip(input);
}
