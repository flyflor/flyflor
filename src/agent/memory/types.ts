export type MemoryNoteSource = 'observation' | 'reflection';

/**
 * EN: One volatile note private to a fixed agent for this process lifetime.
 * ZH: 固定 Agent 在当前进程生命周期内持有的一条易失私有笔记。
 */
export interface MemoryNote {
    id: string;
    content: string;
    source: MemoryNoteSource;
    salience: number;
    createdAt: number;
    lastAccessedAt: number;
}
