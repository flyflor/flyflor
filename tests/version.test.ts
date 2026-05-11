import { describe, expect, test } from "bun:test";
import { formatFlyflorVersion, readFlyflorVersion } from "../src/command/version.ts";

describe("readFlyflorVersion", () => {
    test("从 package.json 读到 semver 版本号", () => {
        const v = readFlyflorVersion({});
        expect(v.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test("未注入构建变量时降级为 dev / source", () => {
        const v = readFlyflorVersion({});
        expect(v.commit).toBe("dev");
        expect(v.target).toBe("source");
    });

    test("注入 FLYFLOR_BUILD_COMMIT 与 TARGET 后透传", () => {
        const v = readFlyflorVersion({
            FLYFLOR_BUILD_COMMIT: "abc1234",
            FLYFLOR_BUILD_TARGET: "linux-x64",
        });
        expect(v.commit).toBe("abc1234");
        expect(v.target).toBe("linux-x64");
    });

    test("空字符串视为未注入", () => {
        const v = readFlyflorVersion({
            FLYFLOR_BUILD_COMMIT: "   ",
            FLYFLOR_BUILD_TARGET: "",
        });
        expect(v.commit).toBe("dev");
        expect(v.target).toBe("source");
    });

    test("bun / platform / arch 字段非空", () => {
        const v = readFlyflorVersion({});
        expect(v.bunVersion.length).toBeGreaterThan(0);
        expect(["darwin", "linux", "win32", "freebsd", "openbsd"]).toContain(v.platform);
        expect(v.arch.length).toBeGreaterThan(0);
    });
});

describe("formatFlyflorVersion", () => {
    test("输出 4 行：version / target / bun / host", () => {
        const text = formatFlyflorVersion({
            version: "1.2.3",
            commit: "deadbee",
            target: "linux-arm64",
            bunVersion: "1.3.10",
            platform: "linux",
            arch: "arm64",
        });
        const lines = text.split("\n");
        expect(lines).toHaveLength(4);
        expect(lines[0]).toBe("flyflor 1.2.3 (deadbee)");
        expect(lines[1]).toBe("target  linux-arm64");
        expect(lines[2]).toBe("bun     1.3.10");
        expect(lines[3]).toBe("host    linux/arm64");
    });

    test("默认参数读取当前环境信息", () => {
        const text = formatFlyflorVersion();
        expect(text).toContain("flyflor ");
        expect(text).toContain("target  ");
        expect(text).toContain("bun     ");
        expect(text).toContain("host    ");
    });
});
