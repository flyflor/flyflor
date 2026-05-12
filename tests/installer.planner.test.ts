import { describe, expect, test } from "bun:test";
import {
    binaryAssetName,
    DEFAULT_RELEASE_BASE,
    InstallTargetArch,
    InstallTargetOs,
    planInstall,
    requiresElevation,
    resolveInstallTarget,
    templatesAssetName,
} from "../scripts/installer.planner.ts";

describe("resolveInstallTarget", () => {
    test("Darwin arm64 → darwin/arm64", () => {
        expect(resolveInstallTarget({ uname: "Darwin", machine: "arm64" })).toEqual({
            os: InstallTargetOs.Darwin,
            arch: InstallTargetArch.Arm64,
        });
    });

    test("Linux aarch64 → linux/arm64", () => {
        expect(resolveInstallTarget({ uname: "Linux", machine: "aarch64" })).toEqual({
            os: InstallTargetOs.Linux,
            arch: InstallTargetArch.Arm64,
        });
    });

    test("Linux x86_64 / amd64 / x64 都映射到 x64", () => {
        for (const m of ["x86_64", "amd64", "x64"]) {
            expect(resolveInstallTarget({ uname: "Linux", machine: m }).arch).toBe(InstallTargetArch.X64);
        }
    });

    test("未知 OS 抛错", () => {
        expect(() => resolveInstallTarget({ uname: "Windows_NT", machine: "x64" })).toThrow(/unsupported os/);
    });

    test("未知 arch 抛错", () => {
        expect(() => resolveInstallTarget({ uname: "Linux", machine: "mips" })).toThrow(/unsupported arch/);
    });
});

describe("binaryAssetName / templatesAssetName", () => {
    test("二进制资产名固定为 flyflor-{os}-{arch}", () => {
        expect(binaryAssetName({ os: InstallTargetOs.Linux, arch: InstallTargetArch.X64 })).toBe("flyflor-linux-x64");
        expect(binaryAssetName({ os: InstallTargetOs.Darwin, arch: InstallTargetArch.Arm64 })).toBe(
            "flyflor-darwin-arm64",
        );
    });

    test("自定义 base 名生效", () => {
        expect(binaryAssetName({ os: InstallTargetOs.Linux, arch: InstallTargetArch.X64 }, "flyflor-edge")).toBe(
            "flyflor-edge-linux-x64",
        );
    });

    test("模板包名固定", () => {
        expect(templatesAssetName()).toBe("flyflor-templates.tar.gz");
    });
});

describe("planInstall", () => {
    const target = { os: InstallTargetOs.Linux, arch: InstallTargetArch.X64 };

    test("latest 走 latest/download 段", () => {
        const plan = planInstall({
            target,
            version: "latest",
            prefix: "/home/u/.flyflor",
            releaseBase: DEFAULT_RELEASE_BASE,
        });
        expect(plan.binaryUrl).toBe("https://github.com/flyflor/flyflor/releases/latest/download/flyflor-linux-x64");
        expect(plan.templatesUrl).toBe(
            "https://github.com/flyflor/flyflor/releases/latest/download/flyflor-templates.tar.gz",
        );
    });

    test("空 version 同 latest 行为", () => {
        const plan = planInstall({
            target,
            version: "",
            prefix: "/home/u/.flyflor",
            releaseBase: DEFAULT_RELEASE_BASE,
        });
        expect(plan.binaryUrl).toContain("latest/download");
    });

    test("v 前缀的 tagged 版本直接使用", () => {
        const plan = planInstall({
            target,
            version: "v0.4.0",
            prefix: "/home/u/.flyflor",
            releaseBase: DEFAULT_RELEASE_BASE,
        });
        expect(plan.binaryUrl).toBe("https://github.com/flyflor/flyflor/releases/download/v0.4.0/flyflor-linux-x64");
    });

    test("缺 v 前缀的 tagged 版本会补 v", () => {
        const plan = planInstall({
            target,
            version: "0.4.0",
            prefix: "/home/u/.flyflor",
            releaseBase: DEFAULT_RELEASE_BASE,
        });
        expect(plan.binaryUrl).toContain("/download/v0.4.0/");
    });

    test("releaseBase 末尾斜杠会被剥除", () => {
        const plan = planInstall({
            target,
            version: "latest",
            prefix: "/home/u/.flyflor/",
            releaseBase: "https://example.com/r/",
        });
        expect(plan.binaryUrl).toBe("https://example.com/r/latest/download/flyflor-linux-x64");
        expect(plan.binaryInstallPath).toBe("/home/u/.flyflor/bin/flyflor");
    });

    test("路径布局符合约定", () => {
        const plan = planInstall({
            target,
            version: "latest",
            prefix: "/opt/flyflor",
            releaseBase: DEFAULT_RELEASE_BASE,
        });
        expect(plan.binDir).toBe("/opt/flyflor/bin");
        expect(plan.binaryInstallPath).toBe("/opt/flyflor/bin/flyflor");
        expect(plan.templatesInstallDir).toBe("/opt/flyflor/templates");
        expect(plan.promptsInstallDir).toBe("/opt/flyflor/prompts");
        expect(plan.pathExportLine).toBe('export PATH="$PATH:/opt/flyflor/bin"');
        expect(plan.invokeName).toBe("flyflor");
        expect(plan.binaryName).toBe("flyflor");
    });

    test("自定义 binaryName 体现到 asset / 路径 / invokeName", () => {
        const plan = planInstall({
            target,
            version: "latest",
            prefix: "/home/u/.flyflor",
            releaseBase: DEFAULT_RELEASE_BASE,
            binaryName: "flyflor-edge",
        });
        expect(plan.binaryAssetName).toBe("flyflor-edge-linux-x64");
        expect(plan.binaryInstallPath).toBe("/home/u/.flyflor/bin/flyflor-edge");
        expect(plan.invokeName).toBe("flyflor-edge");
    });
});

describe("requiresElevation", () => {
    test("/usr 与 /opt 前缀需要 elevation", () => {
        expect(requiresElevation("/usr/local/flyflor")).toBe(true);
        expect(requiresElevation("/opt/flyflor")).toBe(true);
        expect(requiresElevation("/usr")).toBe(true);
        expect(requiresElevation("/opt")).toBe(true);
    });

    test("$HOME 下不需要 elevation", () => {
        expect(requiresElevation("/home/u/.flyflor")).toBe(false);
        expect(requiresElevation("/Users/u/.flyflor")).toBe(false);
    });

    test("非字符串安全降级", () => {
        expect(requiresElevation(undefined as unknown as string)).toBe(false);
    });
});
