/**
 * TUI smoke test — force TUI render even without TTY.
 * Reads stderr logs and verifies basic rendering works.
 */
import { getFlyFlor } from "../src/app.ts";
import { startCliTui } from "../src/command/tui/cli/index.ts";

async function main() {
    const app = await getFlyFlor({ argv: ["bun", "app.ts", "status"], mode: "tui" });
    process.stderr.write("[SMOKE] starting TUI\n");
    await startCliTui(app, "overview");
    process.stderr.write("[SMOKE] TUI exited\n");
}

main().catch((e) => {
    process.stderr.write(`[SMOKE] error: ${e}\n`);
    process.exit(1);
});
