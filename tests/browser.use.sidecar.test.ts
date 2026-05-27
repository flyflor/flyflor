import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, test } from "bun:test";

const SIDECAR = new URL("../scripts/browser.use.sidecar.ts", import.meta.url).pathname;

describe("high-level browser.use process-json sidecar", () => {
    test("reports delegate backend as unavailable when no command is configured", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: {},
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("delegateCommand");
    });

    test("blocks unsafe navigation protocols before invoking a backend", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "navigate", url: "javascript:alert(1)" },
            config: { backend: "cdp", cdpUrl: "http://127.0.0.1:1" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("blocked");
        expect(String(response.body.error)).toContain("blocked protocol");
    });

    test("blocks cloud metadata URLs before invoking a backend", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "open", url: "http://169.254.169.254/latest/meta-data/" },
            config: { backend: "cdp", cdpUrl: "http://127.0.0.1:1" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("blocked");
        expect(String(response.body.error)).toContain("always-blocked browser URL");
    });

    test("reports configured delegate command availability before spawning", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: { delegateCommand: "./missing-browser-use-delegate" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("command is unavailable");
    });

    test("rejects oversized delegate resource config before spawning", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: {
                delegateCommand: "./missing-browser-use-delegate",
                timeoutMs: 120_001,
            },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("failed");
        expect(String(response.body.error)).toContain("config.timeoutMs must be an integer between 1 and 120000");
    });

    test("rejects oversized delegate output caps before spawning", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: {
                delegateCommand: "./missing-browser-use-delegate",
                maxOutputBytes: 2 * 1024 * 1024 + 1,
            },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("failed");
        expect(String(response.body.error)).toContain("config.maxOutputBytes must be an integer between 1 and 2097152");
    });

    test("rejects oversized CDP resource config before opening browser connections", async () => {
        const timeout = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: {
                backend: "cdp",
                cdpUrl: "http://127.0.0.1:1",
                timeoutMs: 120_001,
            },
        }, { expectExit: 1 });
        const outputCap = await invokeSidecar({
            tool: "browser.use",
            input: { action: "snapshot" },
            config: {
                backend: "cdp",
                cdpUrl: "http://127.0.0.1:1",
                maxOutputBytes: 2 * 1024 * 1024 + 1,
            },
        }, { expectExit: 1 });

        expect(timeout.body.ok).toBe(false);
        expect(timeout.body.code).toBe("failed");
        expect(String(timeout.body.error)).toContain("config.timeoutMs must be an integer between 1 and 120000");
        expect(outputCap.body.ok).toBe(false);
        expect(outputCap.body.code).toBe("failed");
        expect(String(outputCap.body.error)).toContain("config.maxOutputBytes must be an integer between 1 and 2097152");
    });

    test("drives browser actions through the CDP backend", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "click", target: "#continue" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({
                ok: true,
                action: "click",
                backend: "cdp",
                readOnly: false,
            });
            expect(server.commands).toEqual([
                {
                    id: 1,
                    method: "Runtime.evaluate",
                    params: expect.objectContaining({
                        expression: expect.stringContaining('const selector = "#continue"'),
                        awaitPromise: true,
                        returnByValue: true,
                    }),
                },
            ]);
        } finally {
            server.stop();
        }
    });

    test("accepts selector as a browser click/type target alias", async () => {
        const server = new MockCdpServer();
        try {
            const click = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "click", selector: "#continue" },
                config: { backend: "cdp", cdpUrl: server.url },
            });
            const type = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "type", selector: "#search", text: "flyflor" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(click).toMatchObject({ ok: true, action: "click", backend: "cdp", readOnly: false });
            expect(type).toMatchObject({ ok: true, action: "type", backend: "cdp", readOnly: false });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Runtime.evaluate",
                "Runtime.evaluate",
            ]);
            expect((server.commands[0] as { params: { expression: string } }).params.expression).toContain('const selector = "#continue"');
            expect((server.commands[1] as { params: { expression: string } }).params.expression).toContain('const selector = "#search"');
        } finally {
            server.stop();
        }
    });

    test("accepts expression as a browser evaluate alias", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "evaluate", expression: "document.title" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({ ok: true, action: "evaluate", backend: "cdp", readOnly: false });
            expect(server.commands).toEqual([
                {
                    id: 1,
                    method: "Runtime.evaluate",
                    params: {
                        expression: "document.title",
                        awaitPromise: true,
                        returnByValue: true,
                    },
                },
            ]);
        } finally {
            server.stop();
        }
    });

    test("builds a compact snapshot with Hermes-style refs and accepts ref targets", async () => {
        const server = new MockCdpServer();
        try {
            const snapshot = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "snapshot", maxElements: 12 },
                config: { backend: "cdp", cdpUrl: server.url },
            });
            const click = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "click", ref: "@e1" },
                config: { backend: "cdp", cdpUrl: server.url },
            });
            const type = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "type", target: "@e2", text: "flyflor" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(snapshot).toMatchObject({ ok: true, action: "snapshot", backend: "cdp", readOnly: true, result: { full: false } });
            expect(click).toMatchObject({ ok: true, action: "click", backend: "cdp", readOnly: false });
            expect(type).toMatchObject({ ok: true, action: "type", backend: "cdp", readOnly: false });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Runtime.evaluate",
                "Runtime.evaluate",
                "Runtime.evaluate",
            ]);
            expect((server.commands[0] as { params: { expression: string } }).params.expression).toContain("data-flyflor-ref");
            expect((server.commands[0] as { params: { expression: string } }).params.expression).toContain(".slice(0, 12)");
            expect((server.commands[1] as { params: { expression: string } }).params.expression).toContain('const selector = "[data-flyflor-ref=\\"e1\\"]"');
            expect((server.commands[2] as { params: { expression: string } }).params.expression).toContain('const selector = "[data-flyflor-ref=\\"e2\\"]"');
        } finally {
            server.stop();
        }
    });

    test("keeps full browser snapshots on the Accessibility tree path", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "snapshot", full: true },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({ ok: true, action: "snapshot", backend: "cdp", readOnly: true, result: { full: true } });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual(["Accessibility.getFullAXTree"]);
        } finally {
            server.stop();
        }
    });

    test("drives Hermes-style scroll and press actions through the CDP backend", async () => {
        const server = new MockCdpServer();
        try {
            const scroll = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "scroll", direction: "down", amount: 2 },
                config: { backend: "cdp", cdpUrl: server.url },
            });
            const press = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "press", key: "Enter" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(scroll).toMatchObject({ ok: true, action: "scroll", backend: "cdp", readOnly: false });
            expect(press).toMatchObject({ ok: true, action: "press", backend: "cdp", readOnly: false });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Runtime.evaluate",
                "Input.dispatchKeyEvent",
                "Input.dispatchKeyEvent",
            ]);
            expect(server.commands[0]).toEqual(
                expect.objectContaining({
                    params: expect.objectContaining({
                        expression: expect.stringContaining('"top":240'),
                    }),
                }),
            );
            expect(server.commands[1]).toEqual(
                expect.objectContaining({
                    params: expect.objectContaining({ key: "Enter", type: "keyDown" }),
                }),
            );
            expect(server.commands[2]).toEqual(
                expect.objectContaining({
                    params: expect.objectContaining({ key: "Enter", type: "keyUp" }),
                }),
            );
        } finally {
            server.stop();
        }
    });

    test("accepts Hermes browser scroll default direction", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "scroll" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({ ok: true, action: "scroll", backend: "cdp", readOnly: false });
            expect(server.commands).toEqual([
                expect.objectContaining({
                    method: "Runtime.evaluate",
                    params: expect.objectContaining({
                        expression: expect.stringContaining('"top":360'),
                    }),
                }),
            ]);
        } finally {
            server.stop();
        }
    });

    test("rejects invalid browser scroll direction before invoking CDP", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "scroll", direction: "sideways" },
            config: { backend: "cdp", cdpUrl: "http://127.0.0.1:1" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("failed");
        expect(String(response.body.error)).toContain("browser.use direction must be up, down, left, or right");
    });

    test("drives Hermes-style back and get_images actions through the CDP backend", async () => {
        const server = new MockCdpServer((command) => {
            if (command.method === "Page.getNavigationHistory") {
                return {
                    id: command.id,
                    result: {
                        currentIndex: 1,
                        entries: [
                            { id: 10, url: "https://example.test/one" },
                            { id: 11, url: "https://example.test/two" },
                        ],
                    },
                };
            }
            return {
                id: command.id,
                result: {
                    result: {
                        type: "object",
                        value: { ok: true, count: 1, images: [{ src: "https://example.test/a.png", alt: "A" }] },
                    },
                },
            };
        });
        try {
            const back = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "back" },
                config: { backend: "cdp", cdpUrl: server.url },
            });
            const images = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "get_images", maxImages: 7 },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(back).toMatchObject({ ok: true, action: "back", backend: "cdp", readOnly: false });
            expect(images).toMatchObject({ ok: true, action: "get_images", backend: "cdp", readOnly: true });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Page.getNavigationHistory",
                "Page.navigateToHistoryEntry",
                "Runtime.evaluate",
            ]);
            expect(server.commands[1]).toEqual(
                expect.objectContaining({
                    params: { entryId: 10 },
                }),
            );
            expect(server.commands[2]).toEqual(
                expect.objectContaining({
                    params: expect.objectContaining({
                        expression: expect.stringContaining(".slice(0, 7)"),
                    }),
                }),
            );
        } finally {
            server.stop();
        }
    });

    test("reports browser back without previous history as a structured failure", async () => {
        const server = new MockCdpServer((command) => ({
            id: command.id,
            result: command.method === "Page.getNavigationHistory"
                ? { currentIndex: 0, entries: [{ id: 10, url: "https://example.test/one" }] }
                : {},
        }));
        try {
            const response = await invokeSidecar({
                tool: "browser.use",
                input: { action: "back" },
                config: { backend: "cdp", cdpUrl: server.url },
            }, { expectExit: 1 });

            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe("failed");
            expect(String(response.body.error)).toContain("no previous browser history entry");
        } finally {
            server.stop();
        }
    });

    test("drives Hermes-style console expression through the CDP backend", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "console", expression: "console.warn('flyflor'); document.title", clear: true },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({ ok: true, action: "console", backend: "cdp", readOnly: false });
            expect(server.commands).toEqual([
                expect.objectContaining({
                    method: "Runtime.evaluate",
                    params: expect.objectContaining({
                        awaitPromise: true,
                        returnByValue: true,
                        expression: expect.stringContaining("flyflor"),
                    }),
                }),
            ]);
            expect((server.commands[0] as { params: { expression: string } }).params.expression).toContain("__flyflorConsoleBuffer");
        } finally {
            server.stop();
        }
    });

    test("rejects invalid console clear values before invoking CDP", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "console", clear: "yes" },
            config: { backend: "cdp", cdpUrl: "http://127.0.0.1:1" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("failed");
        expect(String(response.body.error)).toContain("input.clear must be a boolean");
    });

    test("reports browser vision as unavailable when no vision delegate is configured", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "vision", question: "What is visible?" },
            config: { backend: "cdp", cdpUrl: "http://127.0.0.1:1" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("unavailable");
        expect(String(response.body.error)).toContain("visionDelegateCommand");
    });

    test("captures a CDP screenshot and delegates browser vision analysis through process-json", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-browser-use-vision-"));
        const delegate = join(root, "vision-delegate.ts");
        const log = join(root, "vision-delegate.log");
        await writeFile(
            delegate,
            `import { appendFile } from "node:fs/promises";
const raw = await new Response(Bun.stdin.stream()).text();
await appendFile("${log}", raw);
const request = JSON.parse(raw);
console.log(JSON.stringify({
  analysis: "fixture vision",
  question: request.question,
  annotate: request.annotate,
  screenshotFormat: request.screenshot.format,
  screenshotBytes: Buffer.from(request.screenshot.data, "base64").byteLength,
}));
`,
        );
        await chmod(delegate, 0o755);
        const server = new MockCdpServer((command) => ({
            id: command.id,
            result: command.method === "Page.captureScreenshot"
                ? { data: "aGVsbG8=", format: "png" }
                : { result: { type: "object", value: { ok: true } } },
        }));
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "vision", question: "What is visible?", annotate: true },
                config: { backend: "cdp", cdpUrl: server.url, visionDelegateCommand: "bun", visionDelegateArgs: [delegate] },
            });

            expect(response).toMatchObject({
                ok: true,
                action: "vision",
                backend: "cdp",
                readOnly: true,
                result: {
                    screenshot: { format: "png", dataBytes: 5 },
                    vision: {
                        response: {
                            analysis: "fixture vision",
                            question: "What is visible?",
                            annotate: true,
                            screenshotFormat: "png",
                            screenshotBytes: 5,
                        },
                    },
                },
            });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual(["Page.captureScreenshot"]);
            const call = JSON.parse((await readFile(log, "utf8")).trim()) as { screenshot?: { data?: unknown } };
            expect(call.screenshot?.data).toBe("aGVsbG8=");
        } finally {
            server.stop();
            await rm(root, { recursive: true, force: true });
        }
    });

    test("rejects invalid browser vision annotate values before invoking CDP", async () => {
        const response = await invokeSidecar({
            tool: "browser.use",
            input: { action: "vision", question: "What is visible?", annotate: "yes" },
            config: { backend: "cdp", cdpUrl: "http://127.0.0.1:1", visionDelegateCommand: "bun" },
        }, { expectExit: 1 });

        expect(response.body.ok).toBe(false);
        expect(response.body.code).toBe("failed");
        expect(String(response.body.error)).toContain("input.annotate must be a boolean");
    });

    test("reports malformed CDP WebSocket frames as structured failures", async () => {
        const server = new MockCdpServer(() => "not-json");
        try {
            const response = await invokeSidecar({
                tool: "browser.use",
                input: { action: "click", target: "#continue" },
                config: { backend: "cdp", cdpUrl: server.url },
            }, { expectExit: 1 });

            expect(response.body.ok).toBe(false);
            expect(response.body.code).toBe("failed");
            expect(String(response.body.error)).toContain("CDP WebSocket returned non-json response");
        } finally {
            server.stop();
        }
    });

    test("runs browser actions then captureAfter through the CDP backend", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "type", target: "#search", text: "flyflor", captureAfter: true, maxElements: 7 },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({
                ok: true,
                action: "type",
                backend: "cdp",
                readOnly: false,
                captureAfter: {
                    action: "snapshot",
                    backend: "cdp",
                    readOnly: true,
                },
            });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Runtime.evaluate",
                "Runtime.evaluate",
            ]);
            expect((server.commands[1] as { params: { expression: string } }).params.expression).toContain(".slice(0, 7)");
        } finally {
            server.stop();
        }
    });

    test("accepts snake_case capture_after and preserves full snapshot context", async () => {
        const server = new MockCdpServer();
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "click", target: "#continue", capture_after: true, full: true },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(response).toMatchObject({
                ok: true,
                action: "click",
                backend: "cdp",
                readOnly: false,
                captureAfter: {
                    action: "snapshot",
                    backend: "cdp",
                    readOnly: true,
                    result: { full: true },
                },
            });
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Runtime.evaluate",
                "Accessibility.getFullAXTree",
            ]);
        } finally {
            server.stop();
        }
    });

    test("accepts snake_case observation budget aliases", async () => {
        const server = new MockCdpServer((command) => ({
            id: command.id,
            result: command.method === "Page.captureScreenshot"
                ? { data: "aGVsbG8=", format: "png" }
                : {
                    result: {
                        type: "object",
                        value: { ok: true, count: 1, images: [{ src: "https://example.test/a.png" }] },
                    },
                },
        }));
        try {
            const snapshot = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "snapshot", max_elements: 9 },
                config: { backend: "cdp", cdpUrl: server.url },
            });
            const images = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "get_images", max_images: 5 },
                config: { backend: "cdp", cdpUrl: server.url },
            });
            const capture = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "click", target: "#continue", capture_after: true, capture_mode: "screenshot" },
                config: { backend: "cdp", cdpUrl: server.url },
            });

            expect(snapshot).toMatchObject({ ok: true, action: "snapshot", backend: "cdp", readOnly: true });
            expect(images).toMatchObject({ ok: true, action: "get_images", backend: "cdp", readOnly: true });
            expect(capture).toMatchObject({
                ok: true,
                action: "click",
                backend: "cdp",
                captureAfter: {
                    action: "screenshot",
                    backend: "cdp",
                    readOnly: true,
                },
            });
            expect((server.commands[0] as { params: { expression: string } }).params.expression).toContain(".slice(0, 9)");
            expect((server.commands[1] as { params: { expression: string } }).params.expression).toContain(".slice(0, 5)");
            expect(server.commands.map((entry) => (entry as { method: string }).method)).toEqual([
                "Runtime.evaluate",
                "Runtime.evaluate",
                "Runtime.evaluate",
                "Page.captureScreenshot",
            ]);
        } finally {
            server.stop();
        }
    });

    test("runs the requested action through a delegate", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-browser-use-"));
        const delegate = join(root, "delegate.ts");
        const log = join(root, "delegate.log");
        await writeFile(
            delegate,
            `import { appendFile } from "node:fs/promises";
const raw = await new Response(Bun.stdin.stream()).text();
await appendFile("${log}", raw);
const request = JSON.parse(raw);
console.log(JSON.stringify({ receivedAction: request.action, url: request.input.url }));
`,
        );
        await chmod(delegate, 0o755);
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "open", url: "https://example.test/" },
                config: { delegateCommand: "bun", delegateArgs: [delegate] },
            });

            expect(response).toMatchObject({
                action: "open",
                backend: "delegate",
                readOnly: false,
                result: {
                    response: { receivedAction: "open", url: "https://example.test/" },
                },
            });
            const call = JSON.parse((await readFile(log, "utf8")).trim()) as { action: string };
            expect(call.action).toBe("open");
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });

    test("resolves PATH delegates through PATHEXT-style extensions", async () => {
        const root = await mkdtemp(join(tmpdir(), "flyflor-browser-use-pathext-"));
        const delegate = join(root, "delegate.cmd");
        await writeFile(
            delegate,
            `#!/usr/bin/env bun
const raw = await new Response(Bun.stdin.stream()).text();
const request = JSON.parse(raw);
console.log(JSON.stringify({ receivedAction: request.action, url: request.input.url }));
`,
        );
        await chmod(delegate, 0o755);
        try {
            const response = await invokeSidecarBody({
                tool: "browser.use",
                input: { action: "open", url: "https://example.test/" },
                config: { delegateCommand: "delegate" },
            }, {
                env: {
                    ...Bun.env,
                    PATH: `${root}${delimiter}${Bun.env.PATH ?? ""}`,
                    PATHEXT: ".cmd",
                },
            });

            expect(response).toMatchObject({
                action: "open",
                backend: "delegate",
                result: {
                    response: { receivedAction: "open", url: "https://example.test/" },
                },
            });
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});

interface SidecarInvocationResult {
    body: Record<string, unknown>;
    stderr: string;
}

async function invokeSidecarBody(request: Record<string, unknown>, options: { env?: Record<string, string | undefined> } = {}): Promise<Record<string, unknown>> {
    const response = await invokeSidecar(request, options);
    expect(response.stderr).toBe("");
    return response.body;
}

async function invokeSidecar(
    request: Record<string, unknown>,
    options: { env?: Record<string, string | undefined>; expectExit?: number } = {},
): Promise<SidecarInvocationResult> {
    const proc = Bun.spawn(["bun", SIDECAR], { env: options.env, stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const stdin = proc.stdin as { write(chunk: Uint8Array): unknown; end(): void };
    stdin.write(new TextEncoder().encode(`${JSON.stringify(request)}\n`));
    stdin.end();
    const [exit, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(exit).toBe(options.expectExit ?? 0);
    return { body: JSON.parse(stdout.split("\n")[0] ?? "{}") as Record<string, unknown>, stderr };
}

type MockCdpCommand = { id: number; method: string; params?: unknown };

class MockCdpServer {
    public readonly commands: unknown[] = [];
    private readonly server: Bun.Server<{ id: string }>;

    public constructor(
        private readonly respond: (command: MockCdpCommand) => string | Record<string, unknown> = (command) => ({
            id: command.id,
            result: {
                result: command.method === "Accessibility.getFullAXTree"
                    ? { nodes: [] }
                    : {
                        type: "object",
                        value: { ok: true },
                    },
            },
        }),
    ) {
        this.server = Bun.serve<{ id: string }>({
            port: 0,
            fetch: (request, server) => {
                const url = new URL(request.url);
                if (url.pathname === "/devtools/page/1") {
                    const upgraded = server.upgrade(request, { data: { id: "target-1" } });
                    return upgraded ? undefined : new Response("upgrade failed", { status: 400 });
                }
                if (url.pathname === "/json/list") {
                    return Response.json([
                        {
                            id: "target-1",
                            type: "page",
                            url: "about:blank",
                            webSocketDebuggerUrl: this.url.replace("http://", "ws://") + "devtools/page/1",
                        },
                    ]);
                }
                return new Response("not found", { status: 404 });
            },
            websocket: {
                message: (socket, raw) => {
                    const command = JSON.parse(String(raw)) as MockCdpCommand;
                    this.commands.push(command);
                    const response = this.respond(command);
                    socket.send(typeof response === "string" ? response : JSON.stringify(response));
                },
            },
        });
    }

    public get url(): string {
        return this.server.url.toString();
    }

    public stop(): void {
        this.server.stop(true);
    }
}
