# EQ 模块设计

> 语气控制层：只影响表达风格，不参与逻辑判断。
> 2026-05-12

## 0. 设计约束

- **不可参与逻辑决策**：EQ 的信息不能影响路由、记忆、工具调用、推理过程和任何业务判断。
- **零额外延迟**：不能引入新的 LLM 调用、外部请求或额外 I/O。
- **零字符串匹配**：遵循项目全局红线，风格切换使用结构化 `memory_action`，不做语义关键词识别。
- **bun --compile 兼容**：无 native addon，无运行时文件扫描。
- **可迭代**：风格偏好的记忆数据应能被 Crystal 学习，最终可升格为 skill。

## 1. 定位

EQ 模块不是一个独立的内存组件或后台 worker。它是一层**提示词过滤器**，作用在模型的输出风格上，与推理链路完全解耦。

```
模型推理（全权处理逻辑）→ 输出文本 → EQ 风格约束 → 最终呈现
                                  ↑
                          只改写表达方式
                          不碰推理结果
```

架构上，EQ 属于**宪法层（Constitutional Layer）**的扩展，与 SOUL.md、USER.md 同级，但职责更窄：只约束"怎么说"，不约束"说什么"。

## 2. 零开销的实现路径

EQ 不需要新代码路径。它复用现有的三个机制：

| 机制 | 现有入口 | EQ 的用法 |
|------|---------|-----------|
| Markdown 宪法模板 | `templates/prompts/`（已缓存） | 新增 `eq.manifest.md`，定义风格配置 |
| `runtime.system.md` 装配 | `renderRuntimeSystemPrompt`（每轮拼接） | 多一个 `{{eqContext}}` 插槽 |
| `memory_action` 协议 | `actions.ts:4`（结构化 JSON） | `target:"eq"`，`kind:"style"`，切换配置 |

没有任何新依赖、新请求、新 I/O。EQ 信息的加载成本 = 模板缓存命中后的 ~50 tokens 追加。

## 3. EQ Markdown 模板

`templates/prompts/eq.manifest.md`，与 `memory.action.md` 同级。文件内容是一组命名的风格指令段，每段是一个独立配置：

```markdown
<!-- eq.manifest.md -->
EQ profiles — each profile is a compact style instruction.

## professional
Use formal language. Prefer precise terms over colloquial ones. 
Keep sentences complete. Avoid emoji and exclamation marks.

## friendly  
Write as a helpful peer. Use natural, warm language. 
You can use emoji occasionally. Be encouraging.

## concise
Answer in the fewest words possible. No pleasantries.
One paragraph max unless the answer needs structure.

## detailed
Provide thorough explanations. Include reasoning steps.
Use examples and analogies. Ask clarifying questions.
```

配置由 `eq.manifest.md` 定义，不在代码里写死任何风格列表（遵循红线）。

## 4. 模板装配

在 `runtime.system.md` 新增 `{{eqContext}}` 插槽，位置在 memory 和 skill 之后、blackboard 之前（即所有推理上下文之后）：

```markdown
{{memoryContext}}

Loaded skills:
{{skillContext}}

Output style:
{{eqContext}}

Configured MCP servers:
{{mcpContext}}
```

`eqContext` 在 `prompts/index.ts` 中通过 `renderEqContextPrompt` 渲染，内容来自：

1. **默认配置**：`eq.manifest.md` 中标记为 default 的配置（若无显式切换，使用第一个配置）
2. **用户切换**：通过 `memory_action` 切换后的生效配置（从 user.md 读取首选项）

渲染输出示例（以 professional 为例）：

```
Output style instructions — these affect ONLY how you phrase your answer, 
not what you decide. Do not change your reasoning based on this section.

Write in professional tone. Use formal language. Prefer precise terms 
over colloquial ones. Keep sentences complete. Avoid emoji and exclamation marks.
```

关键设计：**"这些只影响表达方式，不影响推理"** 这句隔离声明确保 EQ 不渗入逻辑。

## 5. 配置切换

通过已有的 `memory_action` 协议切换，不新增接口：

```json
<flyflor_memory_actions>
[
    {
        "action": "add",
        "target": "eq",
        "kind": "style",
        "content": "friendly",
        "confidence": 0.9
    }
]
```

`target:"eq"` 在 `actions.ts` 中新增一个有效枚举值。代码处理逻辑：

- `targetFileForMemoryAction("eq")` → 写入 `user.md`（EQ 偏好是用户级偏好，放在 USER.md 中）
- 下次 `buildPrompt` 时，`MarkdownMemoryStore` 的 `snapshot`(eq 配置) 被 `renderEqContextPrompt` 读取并注入

没有新增存储层，没有新增协议解析逻辑。

## 6. 与 Crystal 的关系

EQ 配置可以参与 Crystal 的学习：

- 频繁切换配置 → 用户对风格敏感 → `consolidation worker` 可以**标记**高 confidence 风格为偏好
- 长时间未切换 → 当前配置稳定 → 可**加强**其在 user.md 中的权重
- 矛盾检测：如果用户多次手动切到某配置后又切走，crystal 可以记录信号

但 Crystal 不能**自动切换** EQ 配置。EQ 配置的切换只能：
1. 用户显式 `memory_action`
2. 第一次启动时的默认值

这是 EQ 不参与逻辑判断的硬边界。

## 7. prompts/index.ts 新增接口

最小化新增：

```typescript
export interface EqContextPromptInput {
    profileBody: string; // 当前生效的 EQ 风格指令文本
    isolationStatement: string; // "这些只影响表达方式" 声明
}

export function renderEqContextPrompt(input: EqContextPromptInput): string {
    return renderTemplate(requiredTemplates().eqManifest, {
        profileBody: input.profileBody,
        isolationStatement: input.isolationStatement,
    });
}
```

其中 `eqManifest` 是新增的模板 key，指向 `eq.manifest.md`。`renderEqContextPrompt` 在运行时被 `runtime.module.ts` 的 `buildPrompt` 或 `handleMessage` 调用。

## 8. 新增文件清单

| 文件 | 类型 | 作用 |
|------|------|------|
| `templates/prompts/eq.manifest.md` | 新增 | EQ 风格配置清单 |
| `templates/prompts/eq.manifest.zh.cn.md` | 新增 | 中文审查副本 |

## 9. 代码修改清单

| 文件 | 改动 |
|------|------|
| `src/agent/prompts/index.ts` | 新增 `eqManifest` 模板 key，`renderEqContextPrompt`，类型 |
| `src/agent/runtime/runtime.module.ts` | `handleMessage` 中渲染 `eqContext` 并传入 system prompt |
| `src/agent/neural/memory/actions.ts` | `target` 枚举增加 `"eq"` |
| `src/protocol/contracts/enums.ts` | `MemoryTarget` 或相关枚举增加 eq（若 enum 集中管理） |
| `templates/prompts/runtime.system.md` | 新增 `{{eqContext}}` 插槽 |

改动的共同特征：**不新增模块、不新增 worker、不新增存储、不新增网络请求。** 所有改动都是已有机制的扩展。

## 10. 与其他模块的关系

| 模块 | 关系 |
|------|------|
| Session | 无关。EQ 不依赖 session。 |
| Blackboard | 无关。EQ 不参与黑板决策。 |
| MCP | 无关。EQ 不影响工具调用。 |
| Skill | 弱相关。EQ 配置可被 Crystal 标记为 skill，但 skill 不能改变 EQ。 |
| Crystal | 单向。Crystal 可以学习 EQ 偏好，但不能改写 EQ。 |
| Neural (Redis) | 无关。EQ 配置存在 Markdown 层，不走 Redis。 |
| Dream | 无关。EQ 不参与记忆重组。 |
| Reflection | 无关。EQ 不产生反思候选。 |

这个交集的特性确保了 EQ 模块可以安全地添加到任何路径上而不会引入副作用。

## 11. 一句话总结

EQ 模块 = `eq.manifest.md`（风格列表）+ `{{eqContext}}`（system prompt 插槽）+ `target:"eq"`（切换协议），三处改动加起来 < 50 行代码，零新增 I/O，零新增 LLM 调用。
