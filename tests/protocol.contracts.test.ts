import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const CONTRACT_DIR = join(import.meta.dir, "..", "src", "protocol", "contracts");

describe("protocol contract comments", () => {
    test("public protocol contracts do not claim shipped contracts are unconsumed", async () => {
        const files = (await readdir(CONTRACT_DIR))
            .filter((name) => name.endsWith(".ts"))
            .sort();
        const offenders: string[] = [];
        for (const file of files) {
            const text = await readFile(join(CONTRACT_DIR, file), "utf8");
            if (text.includes("未消费")) {
                offenders.push(file);
            }
        }
        expect(offenders).toEqual([]);
    });
});
