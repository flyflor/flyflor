import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { renderCliCommandsDoc } from "../src/command/cli/commands.docs.ts";

const args = new Set(process.argv.slice(2));
const check = args.has("--check");
const write = args.has("--write");
const outPath = join(import.meta.dir, "..", "docs", "cli.commands.md");

if (!check && !write) {
    console.error('Usage: bun run scripts/cli.commands.docs.ts [--check|--write]');
    process.exit(1);
}

const generated = renderCliCommandsDoc().trimEnd() + "\n";
const checkedIn = (await Bun.file(outPath).text()).trimEnd() + "\n";

if (check) {
    if (generated !== checkedIn) {
        console.error("docs/cli.commands.md is out of date. Run `bun run docs:cli`.");
        process.exit(1);
    }
    process.exit(0);
}

if (write) {
    await mkdir(dirname(outPath), { recursive: true });
    await writeFile(outPath, generated);
    process.exit(0);
}
