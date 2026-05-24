import { runBrowserCdpSidecar } from "../../../scripts/browser.cdp.sidecar.ts";
import { runComputerNativeSidecar } from "../../../scripts/computer.native.sidecar.ts";
import { runComputerUseSidecar } from "../../../scripts/computer.use.sidecar.ts";
import { runMediaSidecar } from "../../../scripts/media.sidecar.ts";
import { runMockSidecar } from "../../../scripts/mock.sidecar.ts";
import { runUtilitySidecar } from "../../../scripts/utility.sidecar.ts";
import { runWebSearchSidecar } from "../../../scripts/web.search.sidecar.ts";

type SidecarRunner = () => Promise<void>;

const SIDECAR_RUNNERS = new Map<string, SidecarRunner>([
    ["browser.cdp", runBrowserCdpSidecar],
    ["computer.native", runComputerNativeSidecar],
    ["computer.use", runComputerUseSidecar],
    ["media.local", runMediaSidecar],
    ["mock.xtools", runMockSidecar],
    ["utility.local", runUtilitySidecar],
    ["web.search", runWebSearchSidecar],
]);

/**
 * Runs bundled process-json sidecars from the compiled kernel binary.
 *
 * External tool manifests can point at `flyflor xtool-sidecar <id>` instead of
 * requiring users to install Bun or keep TypeScript sidecar files on disk.
 */
export class BundledSidecarRunner {
    public async run(id: string | undefined): Promise<never> {
        const runner = id ? SIDECAR_RUNNERS.get(id) : undefined;
        if (!runner) {
            process.stderr.write(`unknown bundled sidecar: ${id ?? "<missing>"}\n`);
            process.exit(2);
        }
        await runner();
        process.exit(0);
    }
}
