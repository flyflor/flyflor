import { describe, expect, test } from "bun:test";

describe("Docker binary build", () => {
    test("uses browser conditions so Solid effects drive the TUI", async () => {
        const script = await Bun.file("scripts/build.docker.binary.ts").text();

        expect(script).toContain('"--conditions=browser"');
    });
});
