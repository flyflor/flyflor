/**
 * Ask 块解析器（LF-R3）。
 *
 * 模型同轮可在自由文本中嵌入一个 `<agent_question>{json}</agent_question>` 块
 * 来表达 `kind='ask'`。runtime 严禁通过 text.includes / 正则 / 关键词判断是否要 ask
 * （业务语义零字符匹配红线）；ask 必须由模型显式输出本块。
 */

import { Component } from "../../../agent/di/decorators/index.ts";
import { MemoryComponent } from "../../../components/index.ts";
import type { AgentAsk } from "../../../protocol/contracts/index.ts";
import { extractStructuredBlocks, parseStructuredJson, StructuredBlockProtocol } from "../../../protocol/index.ts";
import { AskNormalizer, askNormalizer } from "./normalizer.ts";

export interface ParsedAgentAsk {
    /** 同轮第一段合法 ask 块；多余或坏掉的 ask 块会计入 dropped，避免模型格式漂移打断本轮。 */
    ask?: AgentAsk;
    /** 文本中剥离 ask 块后剩下的 visible reply 文本（仍是 raw model output）。 */
    text: string;
    /** 被丢弃的坏块或额外块数量，用于观察模型协议漂移。 */
    dropped: number;
}

/**
 * AgentAsk structured block parser.
 *
 * The parser owns block extraction only; payload validation and defaults are
 * delegated to AskNormalizer so all ASK sources share one normalization path.
 */
@Component()
export class AskParser extends MemoryComponent {
    public constructor(private readonly normalizer: AskNormalizer = askNormalizer) {
        super();
    }

    public parse(rawText: string): ParsedAgentAsk {
        let firstAsk: AgentAsk | undefined;
        let dropped = 0;
        const extracted = extractStructuredBlocks(rawText, StructuredBlockProtocol.AgentAsk);
        for (const block of extracted.blocks) {
            try {
                const candidate = this.readAsk(block.content);
                if (firstAsk) {
                    dropped += 1;
                    continue;
                }
                firstAsk = candidate;
            } catch {
                dropped += 1;
            }
        }
        return { ask: firstAsk, text: extracted.text, dropped };
    }

    public normalizePayload(payload: unknown): AgentAsk {
        return this.normalizer.normalizePayload(payload);
    }

    private readAsk(rawJson: string): AgentAsk {
        const payload = parseStructuredJson(rawJson);
        return this.normalizer.normalizePayload(payload);
    }
}

/** Compatibility class name retained for older imports and tests. */
export class AgentAskParser extends AskParser {}

export const askParser = new AskParser();
export const agentAskParser = new AgentAskParser();

export function parseAgentAsk(rawText: string): ParsedAgentAsk {
    return agentAskParser.parse(rawText);
}
