import { runFlyflorCommand } from "./src/command/index.ts";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log("flyflor 0.1.0");
    process.exit(0);
}

const result = await runFlyflorCommand(process.argv);
process.exitCode = result.exitCode;
