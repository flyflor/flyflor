import { getFlyFlor } from "./src/app.ts";
import { BundledSidecarRunner } from "./src/executive/index.ts";
import { formatFlyflorVersion } from "./src/version.ts";
import { RuntimeMode } from "./src/protocol/index.ts";

if (process.argv.includes("--version") || process.argv.includes("-V")) {
    console.log(formatFlyflorVersion());
    process.exit(0);
}

if (process.argv[2] === "xtool-sidecar") {
    await new BundledSidecarRunner().run(process.argv[3]);
}

const mode = normalizeEntryMode(process.argv.slice(2));
const app = await getFlyFlor({ argv: process.argv, mode });
await app.start();

function normalizeEntryMode(argv: string[]): typeof RuntimeMode.Chat | typeof RuntimeMode.Gateway | typeof RuntimeMode.Socket {
    const first = argv[0];
    if (first === RuntimeMode.Socket || first === RuntimeMode.Gateway) {
        return first;
    }
    return RuntimeMode.Chat;
}
