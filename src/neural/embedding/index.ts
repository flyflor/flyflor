export interface EmbeddingProvider {
    dimensions: number;
    embed(text: string): Promise<number[]>;
}

export class LocalHashEmbeddingProvider implements EmbeddingProvider {
    public constructor(public readonly dimensions: number) {}

    public async embed(text: string): Promise<number[]> {
        const vector = new Array<number>(this.dimensions).fill(0);
        const tokens = tokenize(text);
        for (const token of tokens) {
            const hash = fnv1a(token);
            const index = hash % this.dimensions;
            vector[index] = (vector[index] ?? 0) + (hash % 2 === 0 ? 1 : -1);
        }
        normalize(vector);
        return vector;
    }
}

function tokenize(text: string): string[] {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((token) => token.length >= 2 && token.length <= 64)
        .slice(0, 2048);
}

function fnv1a(value: string): number {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
}

function normalize(vector: number[]): void {
    const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
    if (magnitude === 0) {
        return;
    }
    for (let index = 0; index < vector.length; index += 1) {
        vector[index] = vector[index]! / magnitude;
    }
}
