# 目录架构

## 一句话定位

本文件是 Flyflor 主线源码目录的权威分层索引。目标是让“目录边界”和“代码真实 owner”保持 0 漂移。

## 主线源码分层

| 路径 | 层级 | 角色 |
| --- | --- | --- |
| `app.ts` | entry | 薄入口，只做版本/模式分派 |
| `src/app.ts` | composition root | 主装配入口，显式连线各模块 |
| `src/cognitive` | cognitive | Mindstream / Crystal / Hippocampus 认知内核 |
| `src/executive` | executive | Capability / Tool / Trust / Loop 外骨骼 |
| `src/agent` | agent | runtime / gateway / sandbox / blackboard / worker / prompts / mcp / plugin / skills 等外显面 |
| `src/events` | events | RuntimeEvent 发布、订阅、分类、sink |
| `src/protocol` | protocol | contracts / control / processes 等公共协议 |
| `src/config` | config | JSONC 配置、默认值、路径装配 |
| `src/entities` | data entity | row / record 映射与 repo SQL |
| `src/components` | shared base | 共享 Component 基类与跨模块基础设施 |
| `src/types` | shared types | 不适合放入单一领域目录的轻量共享类型 |

## `src/agent` 细分

| 路径 | 角色 |
| --- | --- |
| `src/agent/blackboard` | 黑板运行边界与存储 owner |
| `src/agent/context` | project / fork / capability scope 装配 |
| `src/agent/di` | metadata、decorator、显式容器与 factory |
| `src/agent/gateway` | 最小 WS/control/event 血管与 kit 只读发现 |
| `src/agent/mcp` | MCP transport client 与 catalog/validator |
| `src/agent/plugin` | plugin registry / runner / descriptor |
| `src/agent/prompts` | prompt 模板读取、渲染入口、manifest/docs |
| `src/agent/runtime` | turn 主链、routing、planning、reflection、streaming、turn helpers |
| `src/agent/sandbox` | 工具审批、配额、审计与 gate |
| `src/agent/skills` | skill manifest、usage、offer、promotion |
| `src/agent/worker` | worker manager 与线程/子进程包装 |

## `src/cognitive` 细分

| 路径 | 角色 |
| --- | --- |
| `src/cognitive/mindstream` | provider 协议转换、推理/生成心流 |
| `src/cognitive/crystal` | reflection、gems、长期晶体智力沉淀 |
| `src/cognitive/hippocampus` | ask / ghost / identity / dormant / memory / project 等海马体边界 |
| `src/cognitive/hippocampus/memory` | brain / working / graph / recall / summary / lifecycle / dream / hot compression |

## `src/entities` 细分

| 路径 | 角色 |
| --- | --- |
| `src/entities/blackboard` | 黑板表模型与 repo |
| `src/entities/crystal` | 晶体层数据实体与 repo |
| `src/entities/memory/brain/*` | `brain.db` 各 owner 的 entity / repo |
| `src/entities/memory/sqlite/*` | SQLite graph / memory store 相关实体层 |

约束：

- `src/entities` 只做 row / record 映射与 SQL repo。
- service 层语义必须回到 `src/cognitive/*` 或 `src/agent/*`。

## `src/components` 与 `src/types`

这两个目录经常最容易漂移，需要特别明确：

- `src/components` 只放共享 Component 基类与真正跨模块基础设施；当前例如 `src/components/sql`。
- `src/types` 只放轻量共享类型收口，不承载业务 owner，也不替代 `src/protocol/contracts`。

禁止：

- `src/components/memory` / `src/components/crystal` 这类领域兼容壳
- 把业务逻辑塞进 `src/types`

## `src/protocol` 细分

| 路径 | 角色 |
| --- | --- |
| `src/protocol/contracts` | 枚举、公共 contract、structured block |
| `src/protocol/control` | WS/control envelope、semantic lane、snapshot payload |
| `src/protocol/processes` | 进程/监督相关协议 |

## 当前主线不再包含

以下目录已从主源码移除：

- `src/command`
- `src/agent/gateway/channels`

对应历史实现只留在 `abandon/` 备份，不允许主线 import。

## Rust 对接最小依赖面

后续 Rust 客户端和服务端主要依赖：

- `src/protocol/control`
- `src/protocol/contracts`
- `src/events`
- `docs/control.protocol.md`
- `docs/runtime.events.md`
- `docs/rust.integration.md`

## 红线

- 不把 `abandon/` 当兼容层。
- 不重新把 CLI/TUI/channel adapter 放回主线。
- 不让 `src/agent/gateway` 再长成大而全的第一方 surface。
- 不让目录文档落后于真实 `src/` 分层。
