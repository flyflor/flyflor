import { Component, FComponent, Inject } from "@/core";
import { MemoryRepo, type MemoryEntity } from "@/entities";

/**
 * The agent's memory access component (shard slice).
 * Wraps `MemoryRepo` to store/recall scope-local memories. Until a storage backend connects, methods return
 * parameterized SQL plans rather than faking persistence (honest data path, no swallowed failures).
 */
@Component()
export class MemoryComponent extends FComponent {
    @Inject() public readonly repo!: MemoryRepo;

    public store(scopeId: string, content: string): { sql: string; params: string[] } {
        const record: MemoryEntity = {
            id: crypto.randomUUID(),
            scopeId,
            content,
            createdAt: new Date().toISOString(),
        };
        return this.repo.insertMemory(record);
    }

    public recall(scopeId: string): { sql: string; params: string[] } {
        return this.repo.selectByScope(scopeId);
    }
}
