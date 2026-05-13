#!/usr/bin/env bun
/**
 * brain.db monthly cold-archive admin entrypoint.
 *
 * Moves archived events older than the cutoff month into per-month archive dbs:
 *
 *   <brainDir>/archive/brain.YYYY-MM.db
 *
 * The reusable implementation lives in `src/neural/memory/brain.archive.ts`
 * so runtime automation and this admin script share one contract.
 */

import { runBrainArchive } from "../src/neural/memory/brain.archive.ts";

interface CliOptions {
    brainPath: string;
    cutoffMonths: number;
    dryRun: boolean;
    vacuum: boolean;
}

function parseArgs(argv: string[]): CliOptions {
    const opts: CliOptions = {
        brainPath: "",
        cutoffMonths: 3,
        dryRun: false,
        vacuum: false,
    };
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        switch (arg) {
            case "--brain":
                opts.brainPath = argv[++i] ?? "";
                break;
            case "--months":
                opts.cutoffMonths = Math.max(1, Number(argv[++i] ?? "3"));
                break;
            case "--dry-run":
                opts.dryRun = true;
                break;
            case "--vacuum":
                opts.vacuum = true;
                break;
            case "--help":
            case "-h":
                printHelp();
                process.exit(0);
        }
    }
    if (!opts.brainPath) {
        console.error("Error: --brain <path> is required");
        printHelp();
        process.exit(1);
    }
    return opts;
}

function printHelp(): void {
    console.error(
        [
            "Usage: bun run scripts/brain.archive.ts --brain <path> [options]",
            "",
            "Required:",
            "  --brain <path>      Path to live brain.db",
            "",
            "Options:",
            "  --months <n>        Cutoff in months (default 3). Months strictly older",
            "                      than (today - n months) are archived.",
            "  --dry-run           Show plan without writing.",
            "  --vacuum            VACUUM live brain.db after archiving.",
            "  -h, --help          Show this help.",
        ].join("\n"),
    );
}

async function main(): Promise<void> {
    const opts = parseArgs(process.argv.slice(2));
    const result = await runBrainArchive({
        brainPath: opts.brainPath,
        archiveAfterMonths: opts.cutoffMonths,
        dryRun: opts.dryRun,
        vacuumMode: opts.vacuum ? "always" : "never",
    });

    console.error(`Cutoff month (exclusive): ${result.cutoffMonth}`);
    console.error(`Archive dir: ${result.archiveDir}`);
    if (result.months.length === 0) {
        console.error("No archivable months found.");
        return;
    }
    for (const month of result.months) {
        if (result.dryRun) {
            console.error(
                `[dry-run] would archive ${month.eventsCopied} events ` +
                    `from ${month.bucketMonth} -> ${month.archivePath}`,
            );
            continue;
        }
        console.error(
            `archived ${month.bucketMonth}: events=${month.eventsCopied} ` +
                `states=${month.statesCopied} summaries=${month.summariesCopied} ` +
                `-> ${month.archivePath}`,
        );
    }
    if (result.vacuumed) {
        console.error("VACUUM live brain.db complete.");
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
