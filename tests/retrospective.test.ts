import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { RetrospectiveLog } from "../src/neural/memory/retrospective.ts";

describe("RetrospectiveLog", () => {
    test("creates header on first append and accumulates blocks", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-retro-"));
        const log = new RetrospectiveLog({ projectMemoryDir: dir });

        await log.append({ kind: "consolidate", userId: "u1", episodeId: "ep1", summary: "remembers tea", symbols: ["a", "b"] });
        await log.append({ kind: "discard", userId: "u1", episodeId: "ep2", rationale: "transient" });

        const text = await log.read();
        expect(text).toContain("# RETROSPECTIVE");
        expect(text).toContain("— consolidate");
        expect(text).toContain("— discard");
        expect(text).toContain("ep1");
        expect(text).toContain("ep2");
        expect(text).toContain("symbols: [a, b]");
    });

    test("tail returns last N entries with header", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-retro-tail-"));
        const log = new RetrospectiveLog({ projectMemoryDir: dir });
        for (let i = 0; i < 5; i += 1) {
            await log.append({ kind: "consolidate", episodeId: `ep${i}`, summary: `s${i}` });
        }
        const tailed = await log.read({ tail: 2 });
        expect(tailed).toContain("ep3");
        expect(tailed).toContain("ep4");
        expect(tailed).not.toContain("ep0");
        expect(tailed).not.toContain("ep1");
        expect(tailed).not.toContain("ep2");
    });

    test("read returns empty string when file missing", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-retro-miss-"));
        const log = new RetrospectiveLog({ projectMemoryDir: dir });
        expect(await log.read()).toBe("");
    });

    test("append surfaces write errors from invalid path", async () => {
        const dir = await mkdtemp(join(tmpdir(), "flyflor-retro-invalid-"));
        const filePath = join(dir, "not-a-directory");
        await Bun.write(filePath, "occupied");
        const log = new RetrospectiveLog({ projectMemoryDir: filePath });

        await expect(log.append({ kind: "consolidate", summary: "must fail loudly" })).rejects.toThrow();
    });
});
