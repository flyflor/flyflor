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
} from "../../../protocol/contracts/index.ts";
import { extractStructuredBlocks, parseStructuredJson, StructuredBlockProtocol } from "../../../protocol/index.ts";

const VALID_KINDS: ReadonlySet<string> = new Set(Object.values(IdentityKind));
const MAX_CONTENT_LEN = 240;

/**
 * Identity append structured block parser.
 *
 * Runtime production paths hold this parser. The compatibility function keeps
 * the public import stable while preventing new business logic from collecting
 * around a loose top-level function.
 */
export class IdentityAppendParser {
    public parse(rawText: string, maxAppends = 4): IdentityAppendParseResult {
        const candidates: IdentityAppendCandidate[] = [];
        let dropped = 0;
        // tag 与边界符不在记忆层手写；identity 层只校验 kind/content/confidence。
        const extracted = extractStructuredBlocks(rawText, StructuredBlockProtocol.IdentityAppend);
        for (const block of extracted.blocks) {
            let parsed: IdentityAppendCandidate[];
            try {
                parsed = this.readAppends(block.content);
            } catch {
                dropped += 1;
                continue;
            }
            for (const item of parsed) {
                if (candidates.length >= maxAppends) {
                    dropped += 1;
                    continue;
                }
                candidates.push(item);
            }
        }
        return { candidates, text: extracted.text, dropped };
    }

    private readAppends(rawJson: string): IdentityAppendCandidate[] {
        const payload = parseStructuredJson(rawJson);
        if (!Array.isArray(payload)) {
            throw new Error("flyflor_identity_append must be a JSON array.");
        }
        const out: IdentityAppendCandidate[] = [];
        for (const item of payload) {
            if (!item || typeof item !== "object") continue;
            const record = item as Record<string, unknown>;
            const kind = typeof record.kind === "string" ? record.kind.trim() : "";
            const contentRaw = typeof record.content === "string" ? record.content.trim() : "";
            if (!VALID_KINDS.has(kind) || !contentRaw) {
                continue;
            }
            const content = contentRaw.slice(0, MAX_CONTENT_LEN);
            const confidenceRaw =
                typeof record.confidence === "number" && Number.isFinite(record.confidence) ? record.confidence : 1;
            const confidence = Math.max(0, Math.min(1, confidenceRaw));
            out.push({ kind: kind as IdentityKind, content, confidence });
        }
        return out;
    }
}

export const identityAppendParser = new IdentityAppendParser();

export function parseIdentityAppends(rawText: string, maxAppends = 4): IdentityAppendParseResult {
    return identityAppendParser.parse(rawText, maxAppends);
}
