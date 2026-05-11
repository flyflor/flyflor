import type { ModelClient, ModelMessage } from "../protocol/index.ts";

// Mock 通过模板里的稳定 sentinel 标识识别 prompt 类型；不解析提示词内容。
// 模板里的 `<!-- mock-id: xxx -->` 注释由 templates/prompts/*.md 维护。
const ROUTE_MOCK_ID = "<!-- mock-id: blackboard.route -->";
const REFLECTION_MOCK_ID = "<!-- mock-id: crystal.reflection -->";
const DREAM_MOCK_ID = "<!-- mock-id: memory.dream -->";

export class MockModelClient implements ModelClient {
    async generate(messages: ModelMessage[]): Promise<string> {
        const all = messages.map((m) => m.content).join("\n");
        if (all.includes(ROUTE_MOCK_ID)) {
            return JSON.stringify({
                mode: "direct",
                score: 0,
                reason: "mock-route-direct",
                signals: ["mock"],
                needsReflectionCandidate: false,
            });
        }
        if (all.includes(REFLECTION_MOCK_ID)) {
            return "[]";
        }
        if (all.includes(DREAM_MOCK_ID)) {
            return JSON.stringify({ decisions: [] });
        }
        const lastUser = [...messages].reverse().find((message) => message.role === "user");
        return `Mock model is active. Received: ${lastUser?.content ?? ""}`;
    }
}
