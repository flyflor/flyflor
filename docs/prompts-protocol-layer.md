# Prompts 协议层

## 目的

统一所有 LLM 交互的 prompt 管理——系统 prompt、意图分析 prompt、Agent Worker profile prompt、ASK JSON schema prompt、黑板讨论 prompt、晶体总结 prompt。所有 runtime prompt 通过 `@Prompt` 装饰器加载，不入 TypeScript 文件。

## 架构

```
src/prompts/
  prompts.module.ts         # @Module 组装
  prompts.types.ts          # 协议类型
  prompt.registry.service.ts  # @Service() 统一 prompt 加载和缓存

prompts/
  system.md                 # 现有系统 prompt
  intent.md                 # 现有意图分析 prompt（已有）
  ask.schema.md             # ASK JSON schema prompt（新增）
  agent-explore.md          # explore agent profile prompt（新增）
  agent-discuss.md          # discuss agent profile prompt（新增）
  agent-code.md             # code agent profile prompt（新增）
  agent-investigate.md      # investigate agent profile prompt（新增）
  agent-general.md          # general agent default prompt（新增）
  blackboard-role.md        # 黑板角色 prompt 模板（新增）
  blackboard-synthesize.md  # 黑板收敛合成 prompt（新增）
  crystal-gem-summarize.md  # 晶体 Gem 总结 prompt（新增）
  forgetting-compact.md     # 遗忘压缩 prompt（新增）
  forgetting-drift.md       # 遗忘漂移 prompt（新增）
```

## 协议类型

每个 prompt 在此协议层中都有一个明确的所有者、用途和加载路径。

```typescript
// prompts.types.ts

/**
 * 描述注册到协议层的 prompt。
 */
interface PromptProtocol {
  /** 协议唯一标识 */
  readonly name: string;
  /** 所属系统 */
  readonly owner: 'system' | 'intent' | 'worker' | 'crystal' | 'blackboard' | 'forgetting';
  /** 项目相对路径 */
  readonly path: string;
  /** LLM 角色 */
  readonly role: 'system' | 'user';
  /** 变量占位符列表 */
  readonly variables?: readonly string[];
}
```

## ASK JSON Schema

ASK 由 LLM 通过提示词工程生成 JSON，不硬编码在 TypeScript 中。

```
// prompts/ask.schema.md 内容骨架

当遇到以下情况时，你必须输出 ASK JSON：
- 无法从当前上下文确定用户意图
- 需要用户做出选择才能继续
- 操作存在风险需要确认

输出格式：
{
  "asks": [
    {
      "id": "ask_1",
      "question": "简短的问题描述",
      "options": [
        { "id": "opt_a", "text": "选项A（推荐）", "recommended": true },
        { "id": "opt_b", "text": "选项B" },
        { "id": "opt_c", "text": "选项C" }
      ]
    }
  ]
}

规则：
- 每个 ASK 包含 1-3 个选项
- 第一个选项为标准推荐方案，标记 recommended:true
- 选项文本简短、可执行
- 当无法给出推荐时，不要标记 recommended
```

## Agent Worker Prompt 模板变量

每个 worker profile 的 system prompt 支持以下模板变量，由 PromptRegistryService 在加载时注入：

| 变量 | 来源 |
|------|------|
| `{{WORKSPACE_ROOT}}` | ConfigService.getProjectRoot() |
| `{{AVAILABLE_TOOLS}}` | profile.tools 解析后的工具列表 |
| `{{MAX_STEPS}}` | profile.maxSteps |
| `{{PARENT_TASK}}` | 父 agent 派发的任务描述 |
| `{{CURRENT_DATE}}` | 当前日期 |

## DI 注册

```typescript
@Module({
  imports: [ConfigModule],
  providers: [PromptRegistryService],
  exports: [PromptRegistryService],
})
export class PromptsModule {}
```

## 红线确认

- Runtime prompt 文本不入 TypeScript 文件 ✅
- 每个 prompt 有 `.md` 和 `.zh.cn.md` 镜像 ✅  
- 通过 `@Prompt` 或 `PromptRegistryService` 加载 ✅
- 路径全部相对项目根 ✅
