import { describe, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const INSTALL_SH = join(ROOT, "scripts", "install.sh");
const INSTALL_SOURCE_SH = join(ROOT, "scripts", "install.source.sh");
const INSTALL_DOCKER_SH = join(ROOT, "scripts", "install.docker.sh");
const INSTALL_PS1 = join(ROOT, "scripts", "install.ps1");
const PACKAGE_JSON = join(ROOT, "package.json");
const README = join(ROOT, "README.md");
const GITHUB_SCRIPT_BASE = "https://raw.githubusercontent.com/flyflor/flyflor/master/scripts";

describe("install.sh", () => {
    test("通过 POSIX sh -n 语法检查", async () => {
        const proc = Bun.spawn(["sh", "-n", INSTALL_SH]);
        const exit = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        expect(stderr).toBe("");
        expect(exit).toBe(0);
    });

    test("声明 set -eu", async () => {
        const text = await Bun.file(INSTALL_SH).text();
        expect(text.split("\n").slice(0, 30).join("\n")).toContain("set -eu");
    });

    test("覆盖关键 CLI 选项与降级路径", async () => {
        const text = await Bun.file(INSTALL_SH).text();
        for (const flag of [
            "--version",
            "--home",
            "--global-bin",
            "--binary",
            "--prefix",
            "--release-base",
            "--uninstall",
            "--update",
        ]) {
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
        const proc = Bun.spawn(["sh", INSTALL_SH, "--help"], { stdout: "pipe" });
        const out = await new Response(proc.stdout).text();
        await proc.exited;
        expect(out).toContain("--version");
        expect(out).toContain("--home");
        expect(out).toContain("--global-bin");
        expect(out).toContain("--binary");
        expect(out).toContain("--uninstall");
    });

    test("未知参数立即退出且非零", async () => {
        const proc = Bun.spawn(["sh", INSTALL_SH, "--bogus"], { stdout: "pipe", stderr: "pipe" });
        const exit = await proc.exited;
        expect(exit).not.toBe(0);
    });

    test("缺失选项值时返回稳定错误", async () => {
        const proc = Bun.spawn(["sh", INSTALL_SH, "--prefix"], { stdout: "pipe", stderr: "pipe" });
        const exit = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        expect(exit).not.toBe(0);
        expect(stderr).toContain("requires a value");
    });

    test(
        "在沙盒内实测二进制安装，不污染本机 HOME",
        async () => {
            const sandbox = await createInstallSandbox();
            const prefix = join(sandbox.root, "prefix");
            const tarball = await createTemplateTarball(sandbox.root);
            await writeExecutable(
                join(sandbox.bin, "curl"),
                `#!/usr/bin/env sh
url=""
for arg in "$@"; do
    url="$arg"
done
case "$url" in
    *flyflor-templates.tar.gz) cat "$FLYFLOR_FAKE_TARBALL" ;;
    *) printf '#!/usr/bin/env sh\\necho flyflor\\n' ;;
esac
`,
            );
            const proc = Bun.spawn(
                [
                    "sh",
                    INSTALL_SH,
                    "--binary",
                    "--prefix",
                    prefix,
                    "--global-bin",
                    join(sandbox.root, "global-bin"),
                    "--release-base",
                    "https://example.invalid/releases",
                    "--version",
                    "v0.1.0",
                ],
                {
                    env: sandbox.env({ FLYFLOR_FAKE_TARBALL: tarball }),
                    stdout: "pipe",
                    stderr: "pipe",
                },
            );
            const exit = await proc.exited;
            const stderr = await new Response(proc.stderr).text();
            expect(stderr).toBe("");
            expect(exit).toBe(0);
            expect(await readFile(join(prefix, "bin", "flyflor"), "utf8")).toContain("echo flyflor");
            expect(await readFile(join(sandbox.root, "global-bin", "flyflor"), "utf8")).toContain("echo flyflor");
            expect(await readFile(join(prefix, "prompts", "runtime.system.md"), "utf8")).toContain("runtime");
            expect(await readFile(join(prefix, "templates", "memory", "MEMORY.md"), "utf8")).toContain("memory");
        },
        { timeout: 30_000 },
    );

    test(
        "默认一键安装把源码和配置放到 ~/.flyflor，并全局链接编译后二进制",
        async () => {
            const sandbox = await createInstallSandbox();
            await installFakeGit(sandbox.bin, sandbox.log);
            await installFakeBun(sandbox.bin, sandbox.log);
            const proc = Bun.spawn(
                [
                    "sh",
                    INSTALL_SH,
                    "--repo",
                    "https://example.invalid/flyflor.git",
                    "--branch",
                    "main",
                    "--global-bin",
                    join(sandbox.root, "global-bin"),
                ],
                { env: sandbox.env(), stdout: "pipe", stderr: "pipe" },
            );
            const exit = await proc.exited;
            const stderr = await new Response(proc.stderr).text();
            expect(stderr).toBe("");
            expect(exit).toBe(0);
            await expect(stat(join(sandbox.home, ".flyflor", ".git"))).resolves.toBeTruthy();
            await expect(stat(join(sandbox.home, ".flyflor", "dist", "flyflor"))).resolves.toBeTruthy();
            const linked = await readLinkText(join(sandbox.root, "global-bin", "flyflor"));
            expect(linked).toContain(join(sandbox.home, ".flyflor", "dist", "flyflor"));
            const log = await readFile(sandbox.log, "utf8");
            expect(log).toContain("git clone --branch main https://example.invalid/flyflor.git");
            expect(log).toContain("bun install");
            expect(log).toContain(
                `bun run install:templates -- --target ${join(sandbox.home, ".flyflor", ".config")}`,
            );
            expect(log).toContain("bun run build:binary");
        },
        { timeout: 30_000 },
    );
});

describe("source/docker/windows installers", () => {
    test("source installer keeps the repo local and bootstraps Bun/templates", async () => {
        const text = await Bun.file(INSTALL_SOURCE_SH).text();
        await expect(
            Bun.spawn(["sh", "-n", INSTALL_SOURCE_SH], { stderr: "pipe" }).exited,
        ).resolves.toBe(0);
        expect(text).toContain("git clone");
        expect(text).toContain("git -C \"$TARGET_DIR\" pull --ff-only");
        expect(text).toContain("bun install");
        expect(text).toContain('bun run install:templates -- --target "$CONFIG_DIR"');
        expect(text).toContain("bun run build:binary");
        expect(text).toContain("ln -sf \"$TARGET_DIR/dist/flyflor\"");
        expect(text).toContain(`curl -fsSL ${GITHUB_SCRIPT_BASE}/install.source.sh | bash`);
        const proc = Bun.spawn(["sh", INSTALL_SOURCE_SH, "--target"], { stderr: "pipe" });
        const exit = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        expect(exit).not.toBe(0);
        expect(stderr).toContain("requires a value");
    });

    test("docker installer keeps the repo local and starts compose", async () => {
        const text = await Bun.file(INSTALL_DOCKER_SH).text();
        await expect(
            Bun.spawn(["sh", "-n", INSTALL_DOCKER_SH], { stderr: "pipe" }).exited,
        ).resolves.toBe(0);
        expect(text).toContain("docker compose version");
        expect(text).toContain("bun run docker:templates");
        expect(text).toContain("bun run docker:up");
        expect(text).toContain("bun run build:binary");
        expect(text).toContain("ln -sf \"$TARGET_DIR/dist/flyflor\"");
        expect(text).toContain(`curl -fsSL ${GITHUB_SCRIPT_BASE}/install.docker.sh | bash`);
    });

    test("windows bootstrapper uses PowerShell and keeps the source checkout local", async () => {
        const text = await Bun.file(INSTALL_PS1).text();
        expect(text).toContain("Set-StrictMode -Version Latest");
        expect(text).toContain('$Target = "$HOME\\.flyflor"');
        expect(text).toContain("git clone");
        expect(text).toContain("bun install");
        expect(text).toContain("bun run install:templates -- --target $ConfigDir");
        expect(text).toContain("bun run build:binary");
        expect(text).toContain("flyflor.cmd");
    });

    test("README documents remote-first install commands", async () => {
        const text = await Bun.file(README).text();
        expect(text).toContain(`curl -fsSL ${GITHUB_SCRIPT_BASE}/install.sh | bash`);
        expect(text).toContain(`curl -fsSL ${GITHUB_SCRIPT_BASE}/install.source.sh | bash`);
        expect(text).toContain(`curl -fsSL ${GITHUB_SCRIPT_BASE}/install.docker.sh | bash`);
        expect(text).toContain(`irm ${GITHUB_SCRIPT_BASE}/install.ps1`);
    });

    test("package scripts expose the installer entrypoints", async () => {
        const packageJson = JSON.parse(await Bun.file(PACKAGE_JSON).text()) as {
            scripts?: Record<string, string>;
        };
        expect(packageJson.scripts?.["install:source"]).toContain("install.source.sh");
        expect(packageJson.scripts?.["install:docker"]).toContain("install.docker.sh");
        expect(packageJson.scripts?.["install:windows"]).toContain("install.ps1");
        // Gateway service smoke writes only inside a temporary HOME and keeps
        // host launchd/systemd state untouched.
        expect(packageJson.scripts?.["smoke:gateway:service"]).toContain("gateway.service.smoke.ts");
        // Live MCP smoke is intentionally opt-in and must stay outside the
        // deterministic `test` / `ci` gates, but it still needs a stable package
        // entrypoint for real third-party recovery checks.
        expect(packageJson.scripts?.["smoke:mcp:live"]).toContain("mcp.live.smoke.ts");
    });

    test(
        "在沙盒内实测源码安装，checkout 留在目标目录",
        async () => {
            const sandbox = await createInstallSandbox();
            await installFakeGit(sandbox.bin, sandbox.log);
            await installFakeBun(sandbox.bin, sandbox.log);
            const target = join(sandbox.root, "src", "flyflor");
            const proc = Bun.spawn(
                [
                    "sh",
                    INSTALL_SOURCE_SH,
                    "--target",
                    target,
                    "--repo",
                    "https://example.invalid/flyflor.git",
                    "--branch",
                    "main",
                ],
                { env: sandbox.env(), stdout: "pipe", stderr: "pipe" },
            );
            const exit = await proc.exited;
            const stderr = await new Response(proc.stderr).text();
            expect(stderr).toBe("");
            expect(exit).toBe(0);
            await expect(stat(join(target, ".git"))).resolves.toBeTruthy();
            const log = await readFile(sandbox.log, "utf8");
            expect(log).toContain("git clone --branch main https://example.invalid/flyflor.git");
            expect(log).toContain("bun install");
            expect(log).toContain(`bun run install:templates -- --target ${join(target, ".config")}`);
            expect(log).toContain("bun run build:binary");
            const linked = await readLinkText(join(sandbox.home, ".local", "bin", "flyflor"));
            expect(linked).toContain(join(target, "dist", "flyflor"));
        },
        { timeout: 30_000 },
    );

    test("在沙盒内实测 Docker 一键安装，只调用 compose 入口", async () => {
        const sandbox = await createInstallSandbox();
        await installFakeGit(sandbox.bin, sandbox.log);
        await installFakeBun(sandbox.bin, sandbox.log);
        await installFakeDocker(sandbox.bin, sandbox.log);
        const target = join(sandbox.root, "docker-src", "flyflor");
        const proc = Bun.spawn(
            ["sh", INSTALL_DOCKER_SH, "--target", target, "--repo", "https://example.invalid/flyflor.git"],
            { env: sandbox.env(), stdout: "pipe", stderr: "pipe" },
        );
        const exit = await proc.exited;
        const stderr = await new Response(proc.stderr).text();
        expect(stderr).toBe("");
        expect(exit).toBe(0);
        await expect(stat(join(target, ".git"))).resolves.toBeTruthy();
        const log = await readFile(sandbox.log, "utf8");
        expect(log).toContain("docker compose version");
        expect(log).toContain(`bun run install:templates -- --target ${join(target, ".config")}`);
        expect(log).toContain("bun run docker:templates");
        expect(log).toContain("bun run docker:up");
        expect(log).toContain("bun run build:binary");
        const linked = await readLinkText(join(sandbox.home, ".local", "bin", "flyflor"));
        expect(linked).toContain(join(target, "dist", "flyflor"));
    }, { timeout: 30_000 });
});

interface InstallSandbox {
    root: string;
    bin: string;
    home: string;
    log: string;
    env(extra?: Record<string, string>): Record<string, string | undefined>;
}

async function createInstallSandbox(): Promise<InstallSandbox> {
    const root = await mkdtemp(join(tmpdir(), "flyflor-install-test-"));
    const bin = join(root, "bin");
    const home = join(root, "home");
    const log = join(root, "commands.log");
    await mkdir(bin, { recursive: true });
    await mkdir(home, { recursive: true });
    await writeFile(log, "");
    return {
        root,
        bin,
        home,
        log,
        env(extra = {}) {
            return {
                ...Bun.env,
                ...extra,
                HOME: home,
                PATH: `${bin}:${Bun.env.PATH ?? ""}`,
                FLYFLOR_FAKE_LOG: log,
            };
        },
    };
}

async function writeExecutable(path: string, body: string): Promise<void> {
    await writeFile(path, body);
    await chmod(path, 0o755);
}

async function createTemplateTarball(root: string): Promise<string> {
    const source = join(root, "template-source");
    const tarball = join(root, "flyflor-templates.tar.gz");
    await mkdir(join(source, "prompts"), { recursive: true });
    await mkdir(join(source, "templates", "memory"), { recursive: true });
    await writeFile(join(source, "prompts", "runtime.system.md"), "runtime template\n");
    await writeFile(join(source, "templates", "memory", "MEMORY.md"), "memory template\n");
    const proc = Bun.spawn(["tar", "-czf", tarball, "-C", source, "."], { stdout: "pipe", stderr: "pipe" });
    const exit = await proc.exited;
    if (exit !== 0) {
        const stderr = await new Response(proc.stderr).text();
        throw new Error(`tar failed: ${stderr}`);
    }
    return tarball;
}

async function installFakeGit(bin: string, log: string): Promise<void> {
    await writeExecutable(
        join(bin, "git"),
        `#!/usr/bin/env sh
echo "git $*" >> "${log}"
if [ "$1" = "clone" ]; then
    target=""
    for arg in "$@"; do
        target="$arg"
    done
    mkdir -p "$target/.git"
    exit 0
fi
exit 0
`,
    );
}

async function installFakeBun(bin: string, log: string): Promise<void> {
    await writeExecutable(
        join(bin, "bun"),
        `#!/usr/bin/env sh
echo "bun $*" >> "${log}"
if [ "$1" = "run" ] && [ "$2" = "build:binary" ]; then
    mkdir -p dist
    printf '#!/usr/bin/env sh\\necho flyflor-binary\\n' > dist/flyflor
    chmod +x dist/flyflor
fi
exit 0
`,
    );
}

async function installFakeDocker(bin: string, log: string): Promise<void> {
    await writeExecutable(
        join(bin, "docker"),
        `#!/usr/bin/env sh
echo "docker $*" >> "${log}"
exit 0
`,
    );
}

async function readLinkText(path: string): Promise<string> {
    const proc = Bun.spawn(["readlink", path], { stdout: "pipe", stderr: "pipe" });
    const out = await new Response(proc.stdout).text();
    const exit = await proc.exited;
    if (exit === 0) return out.trim();
    return readFile(path, "utf8");
}
