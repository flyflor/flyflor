import { createHash } from "node:crypto";
import type { QdrantMemoryConfig } from "../../config/index.ts";
import { MemoryLayer } from "../../fpc/contracts/index.ts";
import type { EmbeddingProvider } from "./embedding.ts";
import type { MemoryRecord, MemorySearchRequest, MemorySearchResult } from "./types.ts";

interface QdrantPoint {
    id: string;
    payload?: {
        record?: MemoryRecord;
    };
    score?: number;
}

interface QdrantSearchResponse {
    result?: QdrantPoint[];
}

export class QdrantMemoryStore {
    private initialized = false;

    constructor(
        private readonly config: QdrantMemoryConfig,
        private readonly embeddings: EmbeddingProvider,
    ) {}

    async initialize(): Promise<void> {
        if (!this.config.enabled || this.initialized) {
            return;
        }

        const exists = await this.request(`/collections/${this.config.collection}`, { method: "GET" });
        if (!exists.ok) {
            await this.request(`/collections/${this.config.collection}`, {
                method: "PUT",
                body: JSON.stringify({
                    vectors: {
                        size: this.config.dimensions,
                        distance: "Cosine",
                    },
                }),
            });
        }
        this.initialized = true;
    }

    async upsert(record: MemoryRecord): Promise<void> {
        if (!this.config.enabled) {
            return;
        }
        await this.initialize();
        const vector = await this.embeddings.embed(record.content);
        const response = await this.request(`/collections/${this.config.collection}/points?wait=false`, {
            method: "PUT",
            body: JSON.stringify({
                points: [
                    {
                        id: qdrantPointId(record.id),
                        vector,
                        payload: {
                            record,
                        },
                    },
                ],
            }),
        });
        if (!response.ok) {
            throw new Error(`Qdrant upsert failed: ${response.status}`);
        }
    }

    async search(request: MemorySearchRequest): Promise<MemorySearchResult[]> {
        if (!this.config.enabled) {
            return [];
        }
        await this.initialize();
        const vector = await this.embeddings.embed(request.query);
        const response = await this.request(`/collections/${this.config.collection}/points/search`, {
            method: "POST",
            body: JSON.stringify({
                vector,
                limit: request.limit,
                with_payload: true,
                filter: {
                    must: [
                        {
                            key: "record.scope",
                            match: {
                                any: [request.scope, "global"],
                            },
                        },
                    ],
                },
            }),
        });
        if (!response.ok) {
            return [];
        }

        const payload = (await response.json()) as QdrantSearchResponse;
        const results: MemorySearchResult[] = [];
        for (const point of payload.result ?? []) {
            if (!point.payload?.record) {
                continue;
            }
            results.push({
                layer: MemoryLayer.Qdrant,
                score: point.score ?? 0,
                record: point.payload.record,
            });
        }
        return results;
    }

    private async request(path: string, init: RequestInit): Promise<Response> {
        const response = await fetch(new URL(path, this.config.internalUrl), {
            ...init,
            headers: {
                "content-type": "application/json",
                ...(init.headers ?? {}),
            },
            signal: AbortSignal.timeout(this.config.timeoutMs),
        });
        return response;
    }
}

function qdrantPointId(value: string): string {
    const hex = createHash("sha256").update(value).digest("hex").slice(0, 32);
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${variantNibble(hex[16] ?? "8")}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

function variantNibble(value: string): string {
    const parsed = Number.parseInt(value, 16);
    if (!Number.isFinite(parsed)) {
        return "8";
    }
    return ((parsed & 0x3) | 0x8).toString(16);
}
