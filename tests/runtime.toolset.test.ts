import { describe, expect, test } from "bun:test";
import { filterMcpServersByToolset } from "../src/agent/runtime/mcp/index.ts";

describe("filterMcpServersByToolset", () => {
    const servers = [{ name: "git" }, { name: "shell" }, { name: "search" }];

    test("returns all when allowlist is undefined or empty", () => {
        expect(filterMcpServersByToolset(servers, undefined)).toEqual(servers);
        expect(filterMcpServersByToolset(servers, [])).toEqual(servers);
        expect(filterMcpServersByToolset(servers, ["   "])).toEqual(servers);
    });

    test("filters by allowlist preserving order", () => {
        expect(filterMcpServersByToolset(servers, ["search", "git"]).map((s) => s.name)).toEqual(["git", "search"]);
    });

    test("ignores unknown allowlist entries", () => {
        expect(filterMcpServersByToolset(servers, ["nonexistent"]).map((s) => s.name)).toEqual([]);
    });

    test("trims allowlist entries", () => {
        expect(filterMcpServersByToolset(servers, [" git ", "shell"]).map((s) => s.name)).toEqual(["git", "shell"]);
    });
});
