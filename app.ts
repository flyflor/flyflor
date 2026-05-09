import { getFlyFlor } from "./src/index.ts";

if (process.argv.includes("--version") || process.argv.includes("-v")) {
    console.log("flyflor 0.1.0");
    process.exit(0);
}

const app = await getFlyFlor({ argv: process.argv });
await app.start();
