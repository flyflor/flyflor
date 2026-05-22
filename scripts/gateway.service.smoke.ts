#!/usr/bin/env bun
import { runSocketServiceSmoke } from "./socket.service.smoke.ts";

// Compatibility entrypoint. The active smoke owner is socket.service.smoke.ts.
const report = await runSocketServiceSmoke();
for (const checkResult of report.checks) {
    console.log(`${checkResult.ok ? "ok" : "fail"} ${checkResult.name}${checkResult.detail ? ` — ${checkResult.detail}` : ""}`);
}
const failed = report.checks.filter((entry) => !entry.ok);
if (failed.length > 0) {
    console.error(`socket service smoke failed: ${failed.length} issue(s)`);
    process.exit(1);
}
