/**
 * fastRoute 快照存储抽象。
 *
 * 当前运行时只保留进程内 Map：fastRoute 是单进程热路径优化，
 * 不参与记忆权威状态，也不跨实例同步。
 *
 * 设计约束：
 * - 热路径只允许 O(1) 内存读写。
 * - fastRoute 是性能提示，不能因为缓存状态阻断主 runtime。
 * - 不解析 snapshot 内容做语义判断，纯透传序列化。
 */
import type { FastRouteSnapshot } from "./fast.route.ts";

export interface FastRouteSnapshotStore {
    get(key: string): Promise<FastRouteSnapshot | undefined>;
    set(key: string, snapshot: FastRouteSnapshot): Promise<void>;
}

export class InMemoryFastRouteSnapshotStore implements FastRouteSnapshotStore {
    private readonly map = new Map<string, FastRouteSnapshot>();

    public async get(key: string): Promise<FastRouteSnapshot | undefined> {
        return this.map.get(key);
    }

    public async set(key: string, snapshot: FastRouteSnapshot): Promise<void> {
        this.map.set(key, snapshot);
    }

    public size(): number {
        return this.map.size;
    }
}
