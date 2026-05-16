import { describe, expect, test } from "bun:test";

describe("Docker binary build", () => {
    test("uses browser conditions so TUI state lifecycles match dev mode", async () => {
        const script = await Bun.file("scripts/build.docker.binary.ts").text();

        expect(script).toContain('"--conditions=browser"');
        expect(script).toContain('"--allow-unresolved="');
    });
});
