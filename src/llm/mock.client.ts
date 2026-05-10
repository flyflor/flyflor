import type { ModelClient, ModelMessage } from "../protocol/index.ts";

export class MockModelClient implements ModelClient {
    async generate(messages: ModelMessage[]): Promise<string> {
        const system = messages.find((message) => message.role === "system")?.content ?? "";
        if (system.includes("Return only one JSON object") && system.includes('"mode"')) {
            return JSON.stringify({
                mode: "direct",
                score: 0,
                reason: "mock-route-direct",
                signals: ["mock"],
                needsReflectionCandidate: false,
            });
        }
        if (system.includes("Extract only reusable method knowledge")) {
            return "[]";
        }
        const lastUser = [...messages].reverse().find((message) => message.role === "user");
        return `Mock model is active. Received: ${lastUser?.content ?? ""}`;
    }
}
