import { runFlyflorCommand } from "./src/command/index.ts";
import { formatFlyflorVersion } from "./src/command/version.ts";

if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(formatFlyflorVersion());
    process.exit(0);
}

const result = await runFlyflorCommand(process.argv);
process.exitCode = result.exitCode;
