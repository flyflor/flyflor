import { describe, expect, test } from "bun:test";

describe("Docker binary build", () => {
    test("uses browser conditions so TUI state lifecycles match dev mode", async () => {
        const script = await Bun.file("scripts/build.docker.binary.ts").text();

        expect(script).toContain('"--conditions=browser"');
        expect(script).toContain('"--allow-unresolved="');
    });

    test("release binary build installs cross Linux native packages before compiling targets", async () => {
        const script = await Bun.file("scripts/build.release.binaries.ts").text();
        const packageJson = JSON.parse(await Bun.file("package.json").text()) as { scripts?: Record<string, string> };

        expect(packageJson.scripts?.["build:binary:release"]).toContain("build.release.binaries.ts");
        expect(script).toContain('"--os=linux"');
        expect(script).toContain('"--cpu=*"');
        expect(script).toContain('"build:binary:linux-x64"');
        expect(script).toContain('"build:binary:linux-arm64"');
    });
});
