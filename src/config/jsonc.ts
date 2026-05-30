/**
 * Parses the JSONC/JSON5 config format supported by Bun.
 *
 * @param text - JSONC or JSON5 source text.
 * @returns Parsed JSON value.
 * @usage Keep the project API stable while delegating parsing to Bun's native JSON5 parser.
 */
export function parseJsonc(text: string): unknown {
  return Bun.JSON5.parse(text);
}
