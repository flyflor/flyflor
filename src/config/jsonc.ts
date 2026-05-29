/**
 * Parses the small JSONC subset used by `.config/config.jsonc`.
 *
 * @param text - JSONC source text with optional `//` and block comments.
 * @returns Parsed JSON value.
 * @usage Keep config local and dependency-free while allowing comments in committed config.
 */
export function parseJsonc(text: string): unknown {
  return JSON.parse(stripJsonComments(text));
}

/**
 * Removes comments from JSONC while preserving string literals.
 *
 * @param text - JSONC source text.
 * @returns JSON-compatible text with comments replaced by whitespace.
 * @usage Internal helper for `parseJsonc`.
 */
function stripJsonComments(text: string): string {
  let output = "";
  let inString = false;
  let quote = "";
  for (let index = 0; index < text.length; index += 1) {
    const current = text[index] ?? "";
    const next = text[index + 1] ?? "";
    if (inString) {
      output += current;
      if (current === "\\" && next) {
        index += 1;
        output += next;
        continue;
      }
      if (current === quote) {
        inString = false;
      }
      continue;
    }
    if (current === "\"" || current === "'") {
      inString = true;
      quote = current;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      while (index < text.length && text[index] !== "\n") {
        output += " ";
        index += 1;
      }
      output += "\n";
      continue;
    }
    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      while (index < text.length && !(text[index] === "*" && text[index + 1] === "/")) {
        output += text[index] === "\n" ? "\n" : " ";
        index += 1;
      }
      output += " ";
      continue;
    }
    output += current;
  }
  return output;
}
