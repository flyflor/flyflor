import { describe, expect, test } from "bun:test";
import { compareSemver } from "../src/command/cli/update.ts";

describe("compareSemver", () => {
    test("0.1.0 < 0.2.0", () => {
        expect(compareSemver("0.1.0", "0.2.0")).toBe(-1);
    });
    test("1.0.0 = 1.0.0", () => {
        expect(compareSemver("1.0.0", "1.0.0")).toBe(0);
    });
    test("2.3.4 > 2.3.3", () => {
        expect(compareSemver("2.3.4", "2.3.3")).toBe(1);
    });
    test("0.10.0 > 0.9.0 (numeric not lex)", () => {
        expect(compareSemver("0.10.0", "0.9.0")).toBe(1);
    });
    test("缺位补 0：1.0 vs 1.0.0", () => {
        expect(compareSemver("1.0", "1.0.0")).toBe(0);
    });
    test("污染 garbage 视为 0", () => {
        expect(compareSemver("abc", "def")).toBe(0);
        expect(compareSemver("", "")).toBe(0);
    });
    test("混合污染：1.x.0 解析为 1.0.0", () => {
        expect(compareSemver("1.x.0", "1.0.0")).toBe(0);
    });
});
