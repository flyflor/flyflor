/**
 * EN: One row of the `memories` table: a scope-owned long-term memory record.
 * ZH: `memories` 表的一行：一条按 scope 归属的长期记忆记录。
 */
export class MemoryEntity {
    /** EN: Unique identifier of the memory row. ZH: 记忆行的唯一标识。 */
    public id!: string;
    /** EN: Owning scope that partitions memory queries. ZH: 划分记忆查询范围的归属 scope 标识。 */
    public scopeId!: string;
    /** EN: Stored memory text content. ZH: 存储的记忆文本内容。 */
    public content!: string;
    /** EN: Creation timestamp of the memory row. ZH: 记忆行的创建时间戳。 */
    public createdAt!: string;
}
