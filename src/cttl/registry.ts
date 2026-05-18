import type { CttlRegisteredTool, CttlToolDescriptor, CttlToolExecutor } from "./types.ts";

export class CttlToolRegistry {
    private readonly tools = new Map<string, CttlRegisteredTool>();

    public register(descriptor: CttlToolDescriptor, execute?: CttlToolExecutor): void {
        this.assertDescriptor(descriptor);
        if (this.tools.has(descriptor.name)) {
            throw new Error(`CTTL tool already registered: ${descriptor.name}`);
        }
        this.tools.set(descriptor.name, { descriptor, execute });
    }

    public list(): CttlRegisteredTool[] {
        return [...this.tools.values()].sort((left, right) =>
            left.descriptor.name.localeCompare(right.descriptor.name),
        );
    }

    public get(name: string): CttlRegisteredTool | undefined {
        return this.tools.get(name);
    }

    public has(name: string): boolean {
        return this.tools.has(name);
    }

    public clear(): void {
        this.tools.clear();
    }

    private assertDescriptor(descriptor: CttlToolDescriptor): void {
        if (!descriptor.name.trim()) {
            throw new Error("CTTL tool descriptor requires a non-empty name.");
        }
        if (!/^[a-z][a-z0-9_.-]*$/u.test(descriptor.name)) {
            throw new Error(`Invalid CTTL tool name: ${descriptor.name}`);
        }
        if (!descriptor.description.trim()) {
            throw new Error(`CTTL tool ${descriptor.name} requires a description.`);
        }
        if (descriptor.scope.length === 0) {
            throw new Error(`CTTL tool ${descriptor.name} requires at least one scope.`);
        }
        if (descriptor.resultLimit.maxChars <= 0) {
            throw new Error(`CTTL tool ${descriptor.name} requires a positive resultLimit.maxChars.`);
        }
    }
}

