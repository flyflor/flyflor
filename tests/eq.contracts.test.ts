import { describe, expect, test } from "bun:test";

import {
    EQ_DEFAULT_HALFLIFE_MS,
    EqDirective,
    EqLabel,
    type EqState,
    decayEq,
    deriveEqDirective,
    normalizeEqClassification,
} from "../src/protocol/contracts/eq.ts";

describe("EQ-01 contracts: normalizeEqClassification", () => {
    test("接受合法字段并 round 到 3 位小数", () => {
        const out = normalizeEqClassification({
            label: "joy",
            valence: 0.123456,
            arousal: 0.5,
            dominance: 0.7,
            confidence: 0.9,
        });
        expect(out).toEqual({
            label: EqLabel.Joy,
            valence: 0.123,
            arousal: 0.5,
            dominance: 0.7,
            confidence: 0.9,
        });
    });

    test("非封闭枚举 label 返回 null（不猜测）", () => {
        expect(
            normalizeEqClassification({
                label: "happy",
                valence: 0.5,
                arousal: 0.5,
                dominance: 0.5,
                confidence: 0.5,
            }),
        ).toBeNull();
    });

    test("缺字段返回 null", () => {
        expect(normalizeEqClassification({ label: "joy", valence: 0.1 })).toBeNull();
    });

    test("超界值被 clamp", () => {
        const out = normalizeEqClassification({
            label: "anger",
            valence: -2,
            arousal: 5,
            dominance: -3,
            confidence: 9,
        });
        expect(out).toEqual({
            label: EqLabel.Anger,
            valence: -1,
            arousal: 1,
            dominance: 0,
            confidence: 1,
        });
    });

    test("非对象 / null / 字符串均返回 null", () => {
        expect(normalizeEqClassification(null)).toBeNull();
        expect(normalizeEqClassification("joy")).toBeNull();
        expect(normalizeEqClassification(undefined)).toBeNull();
    });
});

describe("EQ-01 contracts: decayEq", () => {
    const base: EqState = {
        ownerKey: "scope:eq",
                sourceKey: "u1",
        valence: 0.8,
        arousal: 0.6,
        dominance: 0.5,
        label: EqLabel.Joy,
        confidence: 1.0,
        updatedAt: 1_000,
    };

    test("dt=0 不衰减", () => {
        expect(decayEq(base, 1_000)).toEqual(base);
    });

    test("一个半衰期 → valence/arousal/confidence 折半，dominance/label 不变", () => {
        const out = decayEq(base, 1_000 + EQ_DEFAULT_HALFLIFE_MS);
        expect(out.valence).toBeCloseTo(0.4, 3);
        expect(out.arousal).toBeCloseTo(0.3, 3);
        expect(out.confidence).toBeCloseTo(0.5, 3);
        expect(out.dominance).toBe(0.5);
        expect(out.label).toBe(EqLabel.Joy);
    });

    test("两个半衰期 → 1/4", () => {
        const out = decayEq(base, 1_000 + 2 * EQ_DEFAULT_HALFLIFE_MS);
        expect(out.valence).toBeCloseTo(0.2, 3);
    });

    test("负 valence 同样向 0 衰减", () => {
        const sad: EqState = { ...base, valence: -0.8, label: EqLabel.Sadness };
        const out = decayEq(sad, 1_000 + EQ_DEFAULT_HALFLIFE_MS);
        expect(out.valence).toBeCloseTo(-0.4, 3);
    });
});

describe("EQ-02 contracts: deriveEqDirective", () => {
    const base: EqState = {
        ownerKey: "scope:eq",
                sourceKey: "u1",
        valence: 0,
        arousal: 0,
        dominance: 0.5,
        label: EqLabel.Neutral,
        confidence: 0.9,
        updatedAt: 0,
    };

    test("confidence < 0.3 → null（不下结论）", () => {
        expect(deriveEqDirective({ ...base, confidence: 0.2, label: EqLabel.Anger, valence: -0.8, arousal: 0.7 })).toBeNull();
    });

    test("已平复（|valence|<0.15 && arousal<0.15）→ Steady", () => {
        expect(deriveEqDirective({ ...base, valence: 0.05, arousal: 0.05 })).toBe(EqDirective.Steady);
    });

    test("高唤醒 + 负 valence + anger → CalmDown", () => {
        expect(
            deriveEqDirective({ ...base, label: EqLabel.Anger, valence: -0.6, arousal: 0.7 }),
        ).toBe(EqDirective.CalmDown);
    });

    test("高唤醒 + 负 valence + sadness → CalmDown", () => {
        expect(
            deriveEqDirective({ ...base, label: EqLabel.Sadness, valence: -0.5, arousal: 0.5 }),
        ).toBe(EqDirective.CalmDown);
    });

    test("高唤醒 + 负 valence + fear → CalmDown", () => {
        expect(
            deriveEqDirective({ ...base, label: EqLabel.Fear, valence: -0.4, arousal: 0.6 }),
        ).toBe(EqDirective.CalmDown);
    });

    test("高唤醒 + 正 valence + joy → MatchEnergy", () => {
        expect(
            deriveEqDirective({ ...base, label: EqLabel.Joy, valence: 0.7, arousal: 0.6 }),
        ).toBe(EqDirective.MatchEnergy);
    });

    test("高唤醒 + 正 valence + surprise → MatchEnergy", () => {
        expect(
            deriveEqDirective({ ...base, label: EqLabel.Surprise, valence: 0.4, arousal: 0.7 }),
        ).toBe(EqDirective.MatchEnergy);
    });

    test("低唤醒（不在平复区也不在激活区）→ Steady", () => {
        expect(
            deriveEqDirective({ ...base, label: EqLabel.Sadness, valence: -0.3, arousal: 0.2 }),
        ).toBe(EqDirective.Steady);
    });

    test("label 与极性矛盾（joy + 负 valence）→ Steady（不强行套 label）", () => {
        expect(
            deriveEqDirective({ ...base, label: EqLabel.Joy, valence: -0.6, arousal: 0.7 }),
        ).toBe(EqDirective.Steady);
    });
});
