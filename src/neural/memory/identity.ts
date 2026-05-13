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
        if (!parsed) {
            dropped += 1;
            return "";
        }
        for (const item of parsed) {
            if (candidates.length >= maxAppends) {
                dropped += 1;
                continue;
            }
            candidates.push(item);
        }
        return "";
    });
    return { candidates, text: text.trim(), dropped };
}

function readAppends(rawJson: string): IdentityAppendCandidate[] | undefined {
    let payload: unknown;
    try {
        payload = JSON.parse(rawJson);
    } catch {
        return undefined;
    }
    if (!Array.isArray(payload)) return undefined;
    const out: IdentityAppendCandidate[] = [];
    for (const item of payload) {
        if (!item || typeof item !== "object") continue;
        const record = item as Record<string, unknown>;
        const kind = typeof record.kind === "string" ? record.kind.trim() : "";
        const contentRaw = typeof record.content === "string" ? record.content.trim() : "";
        if (!VALID_KINDS.has(kind) || !contentRaw) continue;
        const content = contentRaw.length > MAX_CONTENT_LEN ? contentRaw.slice(0, MAX_CONTENT_LEN) : contentRaw;
        const confidenceRaw =
            typeof record.confidence === "number" && Number.isFinite(record.confidence) ? record.confidence : 1;
        const confidence = Math.max(0, Math.min(1, confidenceRaw));
        out.push({ kind: kind as IdentityKind, content, confidence });
    }
    return out;
}
