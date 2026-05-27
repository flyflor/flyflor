#!/usr/bin/env bun

import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join } from "node:path";

type JsonObject = Record<string, unknown>;

interface BrowserCandidate {
    readonly command: string;
    readonly source: string;
}

interface SmokeResult {
    readonly ok: boolean;
    readonly skipped?: boolean;
    readonly reason?: string;
    readonly browser?: string;
    readonly endpoint?: string;
    readonly checks?: readonly string[];
    readonly failure?: unknown;
}

const SIDECAR = new URL("./browser.use.sidecar.ts", import.meta.url).pathname;
const REQUIRE_BROWSER = Bun.argv.includes("--require-browser");
const TYPE_TEXT = "flyflor-live-browser-use";

class BrowserUseLiveSmoke {
    private readonly locator = new ChromeLocator();
    private readonly invoker = new BrowserUseInvoker(SIDECAR);

    public async run(): Promise<SmokeResult> {
        const browser = await this.locator.find();
        if (!browser) {
            return this.skip("chrome-not-found");
        }

        const profileDir = await mkdtemp(join(tmpdir(), "flyflor-browser-use-profile-"));
        const pageServer = new LocalPageServer();
        let chrome: ReturnType<typeof Bun.spawn> | undefined;
        try {
            const page = pageServer.start();
            const port = await new FreePort().reserve();
            chrome = this.launch(browser.command, profileDir, port);
            const endpoint = `http://127.0.0.1:${port}`;
            await new CdpReadiness(endpoint).wait();

            const checks: string[] = [];
            const config = { backend: "cdp", cdpUrl: endpoint };
            const visionDelegate = await this.writeVisionDelegate(profileDir);
            const visionLog = join(profileDir, "vision-delegate.log");

            const open = await this.invoker.call({ tool: "browser.use", config, input: { action: "open", url: page.url } });
            this.expectOk(open, "open");
            checks.push("open");

            const navigate = await this.invoker.call({ tool: "browser.use", config, input: { action: "navigate", url: page.url } });
            this.expectOk(navigate, "navigate");
            checks.push("navigate");

            const wait = await this.invoker.call({ tool: "browser.use", config, input: { action: "wait", ms: 250 } });
            this.expectOk(wait, "wait");
            checks.push("wait");

            const type = await this.invoker.call({
                tool: "browser.use",
                config,
                input: { action: "type", target: "#name", text: TYPE_TEXT, captureAfter: true },
            });
            this.expectOk(type, "type");
            this.expectCaptureAfter(type, "type");
            checks.push("type-captureAfter");

            const click = await this.invoker.call({
                tool: "browser.use",
                config,
                input: { action: "click", target: "#save", captureAfter: true },
            });
            this.expectOk(click, "click");
            this.expectCaptureAfter(click, "click");
            checks.push("click-captureAfter");

            const evaluate = await this.invoker.call({
                tool: "browser.use",
                config,
                input: { action: "evaluate", script: "document.querySelector('#result')?.textContent ?? ''" },
            });
            this.expectOk(evaluate, "evaluate");
            this.expectEvaluationValue(evaluate, `saved:${TYPE_TEXT}`);
            checks.push("evaluate-state");

            const images = await this.invoker.call({
                tool: "browser.use",
                config,
                input: { action: "get_images", maxImages: 5 },
            });
            this.expectOk(images, "get_images");
            this.expectImages(images);
            checks.push("get-images");

            const secondPage = page.url.replace(/\/?$/u, "/second");
            const navigateSecond = await this.invoker.call({ tool: "browser.use", config, input: { action: "navigate", url: secondPage } });
            this.expectOk(navigateSecond, "navigate");
            checks.push("navigate-second");

            const back = await this.invoker.call({ tool: "browser.use", config, input: { action: "back" } });
            this.expectOk(back, "back");
            checks.push("back");

            const consoleResult = await this.invoker.call({
                tool: "browser.use",
                config,
                input: { action: "console", expression: "console.warn('flyflor-live-console'); document.title", clear: true },
            });
            this.expectOk(consoleResult, "console");
            this.expectConsole(consoleResult);
            checks.push("console-expression");

            const vision = await this.invoker.call({
                tool: "browser.use",
                config: { ...config, visionDelegateCommand: "bun", visionDelegateArgs: [visionDelegate] },
                input: { action: "vision", question: "Describe the page title and input area.", annotate: true },
            });
            this.expectOk(vision, "vision");
            await this.expectVision(vision, visionLog);
            checks.push("vision-delegate");

            const screenshot = await this.invoker.call({
                tool: "browser.use",
                config,
                input: { action: "screenshot", format: "png" },
            });
            this.expectOk(screenshot, "screenshot");
            this.expectScreenshot(screenshot);
            checks.push("screenshot");

            return {
                ok: true,
                browser: browser.source,
                endpoint,
                checks,
            };
        } catch (err) {
            return { ok: false, browser: browser.source, failure: failureSummary(err) };
        } finally {
            pageServer.stop();
            if (chrome) {
                chrome.kill("SIGTERM");
                await Promise.race([chrome.exited, Bun.sleep(2_000)]).catch(() => undefined);
                chrome.kill("SIGKILL");
            }
            await rm(profileDir, { recursive: true, force: true });
        }
    }

    private launch(command: string, profileDir: string, port: number): ReturnType<typeof Bun.spawn> {
        return Bun.spawn({
            cmd: [
                command,
                "--remote-debugging-address=127.0.0.1",
                `--remote-debugging-port=${port}`,
                `--user-data-dir=${profileDir}`,
                "--headless=new",
                "--disable-gpu",
                "--no-first-run",
                "--no-default-browser-check",
                "about:blank",
            ],
            stdout: "pipe",
            stderr: "pipe",
        });
    }

    private expectOk(value: JsonObject, action: string): void {
        if (value.ok !== true || value.action !== action || value.backend !== "cdp") {
            throw new Error(`${action} did not return an ok CDP response: ${JSON.stringify(value).slice(0, 1000)}`);
        }
    }

    private expectCaptureAfter(value: JsonObject, action: string): void {
        const capture = value.captureAfter as JsonObject | undefined;
        if (!capture || capture.action !== "snapshot" || capture.backend !== "cdp" || capture.readOnly !== true) {
            throw new Error(`${action} did not include a read-only snapshot captureAfter`);
        }
    }

    private expectEvaluationValue(value: JsonObject, expected: string): void {
        const response = ((value.result as JsonObject | undefined)?.response as JsonObject | undefined)?.result as JsonObject | undefined;
        if (response?.value !== expected) {
            throw new Error(`evaluate returned ${JSON.stringify(response?.value)} instead of ${JSON.stringify(expected)}`);
        }
    }

    private expectImages(value: JsonObject): void {
        const response = ((value.result as JsonObject | undefined)?.response as JsonObject | undefined)?.result as JsonObject | undefined;
        const payload = response?.value as JsonObject | undefined;
        const images = payload?.images;
        if (payload?.ok !== true || payload.count !== 1 || !Array.isArray(images)) {
            throw new Error(`get_images returned unexpected payload: ${JSON.stringify(value).slice(0, 1000)}`);
        }
    }

    private expectConsole(value: JsonObject): void {
        const response = ((value.result as JsonObject | undefined)?.response as JsonObject | undefined)?.result as JsonObject | undefined;
        const payload = response?.value as JsonObject | undefined;
        const messages = payload?.messages;
        const evaluation = payload?.evaluation as JsonObject | undefined;
        const result = evaluation?.result as JsonObject | undefined;
        if (payload?.ok !== true || !Array.isArray(messages) || messages.length < 1 || result?.value !== "Flyflor Browser Use Live Smoke") {
            throw new Error(`console returned unexpected payload: ${JSON.stringify(value).slice(0, 1000)}`);
        }
    }

    private expectScreenshot(value: JsonObject): void {
        const result = value.result as JsonObject | undefined;
        if (typeof result?.data !== "string" || result.data.length < 100 || result.format !== "png") {
            throw new Error("screenshot did not return png data");
        }
    }

    private async writeVisionDelegate(root: string): Promise<string> {
        const path = join(root, "vision-delegate.ts");
        const log = join(root, "vision-delegate.log");
        await writeFile(
            path,
            `import { appendFile } from "node:fs/promises";
const raw = await new Response(Bun.stdin.stream()).text();
await appendFile(${JSON.stringify(log)}, raw);
const request = JSON.parse(raw);
console.log(JSON.stringify({
  analysis: "live browser vision delegate",
  question: request.question,
  annotate: request.annotate,
  screenshotFormat: request.screenshot.format,
  screenshotBytes: Buffer.from(request.screenshot.data, "base64").byteLength,
}));
`,
        );
        await chmod(path, 0o755);
        return path;
    }

    private async expectVision(value: JsonObject, log: string): Promise<void> {
        const result = value.result as JsonObject | undefined;
        const screenshot = result?.screenshot as JsonObject | undefined;
        const vision = result?.vision as JsonObject | undefined;
        const response = vision?.response as JsonObject | undefined;
        if (screenshot?.format !== "png" || typeof screenshot.dataBytes !== "number" || screenshot.dataBytes < 100) {
            throw new Error(`vision did not include screenshot metadata: ${JSON.stringify(value).slice(0, 1000)}`);
        }
        if (response?.analysis !== "live browser vision delegate" || response.question !== "Describe the page title and input area." || response.annotate !== true) {
            throw new Error(`vision delegate returned unexpected payload: ${JSON.stringify(value).slice(0, 1000)}`);
        }
        const call = JSON.parse((await readFile(log, "utf8")).trim()) as JsonObject;
        const captured = call.screenshot as JsonObject | undefined;
        if (typeof captured?.data !== "string" || captured.data.length < 100) {
            throw new Error("vision delegate did not receive screenshot data");
        }
    }

    private skip(reason: string): SmokeResult {
        return REQUIRE_BROWSER ? { ok: false, skipped: true, reason } : { ok: true, skipped: true, reason };
    }
}

class ChromeLocator {
    public async find(): Promise<BrowserCandidate | undefined> {
        for (const candidate of this.candidates()) {
            if (await executableExists(candidate.command)) {
                return candidate;
            }
        }
        return undefined;
    }

    private candidates(): readonly BrowserCandidate[] {
        const env = Bun.env.FLYFLOR_BROWSER_BIN;
        const platform = process.platform;
        const commands: BrowserCandidate[] = [];
        if (env) commands.push({ command: env, source: `env:${basename(env)}` });
        if (platform === "darwin") {
            commands.push(
                { command: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", source: "macos-google-chrome" },
                { command: "/Applications/Chromium.app/Contents/MacOS/Chromium", source: "macos-chromium" },
                { command: "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary", source: "macos-chrome-canary" },
            );
        }
        if (platform === "win32") {
            const roots = [
                Bun.env.LOCALAPPDATA,
                Bun.env.PROGRAMFILES,
                Bun.env["PROGRAMFILES(X86)"],
            ].filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
            for (const root of roots) {
                commands.push(
                    { command: join(root, "Google", "Chrome", "Application", "chrome.exe"), source: "windows-google-chrome" },
                    { command: join(root, "Chromium", "Application", "chrome.exe"), source: "windows-chromium" },
                );
            }
        }
        commands.push(
            { command: "google-chrome", source: "path:google-chrome" },
            { command: "google-chrome-stable", source: "path:google-chrome-stable" },
            { command: "chromium", source: "path:chromium" },
            { command: "chromium-browser", source: "path:chromium-browser" },
            { command: "chrome", source: "path:chrome" },
            { command: "msedge", source: "path:msedge" },
        );
        return commands;
    }
}

class LocalPageServer {
    private server?: Bun.Server<undefined>;

    public start(): { readonly url: string } {
        this.server = Bun.serve({
            port: 0,
            fetch: () => new Response(this.html(), { headers: { "content-type": "text/html; charset=utf-8" } }),
        });
        return { url: this.server.url.toString() };
    }

    public stop(): void {
        this.server?.stop(true);
    }

    private html(): string {
        return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Flyflor Browser Use Live Smoke</title></head>
<body>
<main>
<label for="name">Name</label>
<input id="name" aria-label="Name" />
<button id="save">Save</button>
<output id="result" aria-live="polite"></output>
<img src="/asset.png" alt="Flyflor fixture" width="16" height="16" />
</main>
<script>
document.querySelector("#save").addEventListener("click", () => {
  document.querySelector("#result").textContent = "saved:" + document.querySelector("#name").value;
});
</script>
</body>
</html>`;
    }
}

class FreePort {
    public async reserve(): Promise<number> {
        const server = Bun.serve({ port: 0, fetch: () => new Response("ok") });
        const port = server.port;
        server.stop(true);
        if (port === undefined) {
            throw new Error("Bun did not allocate a free port");
        }
        await Bun.sleep(25);
        return port;
    }
}

class CdpReadiness {
    public constructor(private readonly endpoint: string) {}

    public async wait(): Promise<void> {
        const started = Date.now();
        while (Date.now() - started < 10_000) {
            try {
                const response = await fetch(new URL("/json/version", normalizedBaseUrl(this.endpoint)));
                if (response.ok) return;
            } catch {
                await Bun.sleep(100);
            }
        }
        throw new Error(`CDP endpoint did not become ready: ${this.endpoint}`);
    }
}

class BrowserUseInvoker {
    public constructor(private readonly sidecar: string) {}

    public async call(request: JsonObject): Promise<JsonObject> {
        const proc = Bun.spawn(["bun", this.sidecar], {
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
        });
        const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
        stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
        stdin.end();
        const [exitCode, stdout, stderr] = await Promise.all([
            proc.exited,
            new Response(proc.stdout).text(),
            new Response(proc.stderr).text(),
        ]);
        const body = this.parse(stdout);
        if (exitCode !== 0) {
            throw new Error(`browser.use sidecar exited ${exitCode}: ${JSON.stringify(body)} ${stderr}`);
        }
        return body;
    }

    private parse(stdout: string): JsonObject {
        const line = stdout.split(/\r?\n/u).find((entry) => entry.trim().length > 0);
        if (!line) throw new Error("browser.use sidecar returned empty stdout");
        return JSON.parse(line) as JsonObject;
    }
}

async function executableExists(command: string): Promise<boolean> {
    if (command.includes("/") || command.includes("\\")) {
        return pathExists(command);
    }
    for (const dir of (Bun.env.PATH ?? "").split(delimiter)) {
        if (dir.trim().length === 0) continue;
        if (await pathExists(join(dir, command))) return true;
        if (process.platform === "win32" && await pathExists(join(dir, `${command}.exe`))) return true;
    }
    return false;
}

async function pathExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function normalizedBaseUrl(value: string): string {
    return value.endsWith("/") ? value : `${value}/`;
}

function failureSummary(err: unknown): unknown {
    if (!(err instanceof Error)) return err;
    return {
        name: err.name,
        message: err.message,
        stack: err.stack?.split("\n").slice(0, 8).join("\n"),
    };
}

const result = await new BrowserUseLiveSmoke().run();
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
if (!result.ok) {
    process.exit(1);
}
