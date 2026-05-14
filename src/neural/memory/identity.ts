/**
 * Identity append 解析器（LF-R5）。
 *
 * 模型同轮可输出一个 `<flyflor_identity_append>[json[]]</flyflor_identity_append>` 块，
 * 每个 entry 形如：`{ "kind": "preference", "content": "<= 240 字自述", "confidence": 0.8 }`。
 *
 * 红线：runtime 只做 enum + 长度校验，绝不解析 content 文本派生 kind 或拆分语义。
 */

import {
    IdentityKind,
    type IdentityAppendCandidate,
    type IdentityAppendParseResult,
} from "../../protocol/contracts/index.ts";

const APPEND_BLOCK = /<flyflor_identity_append>\s*([\s\S]*?)\s*<\/flyflor_identity_append>/g;
const VALID_KINDS: ReadonlySet<string> = new Set(Object.values(IdentityKind));
const MAX_CONTENT_LEN = 240;

export function parseIdentityAppends(rawText: string, maxAppends = 4): IdentityAppendParseResult {
    const candidates: IdentityAppendCandidate[] = [];
    let dropped = 0;
    const text = rawText.replace(APPEND_BLOCK, (_block, rawJson: string) => {
        const parsed = readAppends(rawJson);
        for (const item of parsed) {
            if (candidates.length >= maxAppends) {
                throw new Error(`flyflor_identity_append exceeds max appends: ${maxAppends}.`);
            }
            candidates.push(item);
        }
        return "";
    });
    return { candidates, text: text.trim(), dropped };
}

function readAppends(rawJson: string): IdentityAppendCandidate[] {
    const payload = JSON.parse(rawJson) as unknown;
    if (!Array.isArray(payload)) {
        throw new Error("flyflor_identity_append must be a JSON array.");
    }
    const out: IdentityAppendCandidate[] = [];
    for (const [index, item] of payload.entries()) {
        if (!item || typeof item !== "object") {
            throw new Error(`flyflor_identity_append item ${index + 1} must be an object.`);
        }
        const record = item as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? record.kind.trim() : "";
        const contentRaw = typeof record.content === "string" ? record.content.trim() : "";
        if (!VALID_KINDS.has(kind) || !contentRaw) {
            throw new Error(`flyflor_identity_append item ${index + 1} is invalid.`);
        }
        if (contentRaw.length > MAX_CONTENT_LEN) {
            throw new Error(`flyflor_identity_append item ${index + 1} exceeds ${MAX_CONTENT_LEN} characters.`);
        }
        const content = contentRaw;
        if (typeof record.confidence !== "number" || !Number.isFinite(record.confidence)) {
            throw new Error(`flyflor_identity_append item ${index + 1} requires numeric confidence.`);
        }
        const confidenceRaw = record.confidence;
        const confidence = Math.max(0, Math.min(1, confidenceRaw));
        out.push({ kind: kind as IdentityKind, content, confidence });
    }
    return out;
}
