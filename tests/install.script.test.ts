import { describe, expect, test } from "bun:test";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "..", "scripts", "install.sh");

describe("install.sh", () => {
    test("通过 POSIX sh -n 语法检查", async () => {
        const proc = Bun.spawn(["sh", "-n", SCRIPT]);
        const exit = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        expect(stderr).toBe("");
        expect(exit).toBe(0);
    });

    test("声明 set -eu", async () => {
        const text = await Bun.file(SCRIPT).text();
        expect(text.split("\n").slice(0, 30).join("\n")).toContain("set -eu");
    });

    test("覆盖关键 CLI 选项与降级路径", async () => {
        const text = await Bun.file(SCRIPT).text();
        for (const flag of ["--version", "--prefix", "--release-base", "--uninstall", "--update"]) {
            expect(text).toContain(flag);
        }
        // 必须支持 curl 与 wget 二选一
        expect(text).toContain("command -v curl");
        expect(text).toContain("command -v wget");
        // 必须 chmod +x 二进制
        expect(text).toContain("chmod +x");
        // 必须使用原子 mv 替换二进制
        expect(text).toContain(".new");
    });

    test("--help 输出包含选项摘要", async () => {
        const proc = Bun.spawn(["sh", SCRIPT, "--help"], { stdout: "pipe" });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        expect(out).toContain("--version");
        expect(out).toContain("--prefix");
        expect(out).toContain("--uninstall");
    });

    test("未知参数立即退出且非零", async () => {
        const proc = Bun.spawn(["sh", SCRIPT, "--bogus"], { stdout: "pipe", stderr: "pipe" });
        const exit = await proc.exited;
        expect(exit).not.toBe(0);
    });
});
