# Agent 协议包模板

这个目录是 agent 协议包模板。

普通运行时对话 prompt 只使用以下 canonical 文件：

- `SOUL.md`：智能体自我。定义 agent 名称、身份、自我描述、价值观、沟通风格和行为边界。
- `USER.md`：用户画像。记录稳定的用户侧事实、偏好、习惯、关系预期和沟通预期。
- `EXTENSION.md`：扩展能力摘要。记录额外工具、外部工具调用能力、基础设施、scraping/opencli/codex 类扩展和其他运行能力。它不是长期记忆。

`AGENTS.md` 是锁定的写入控制宪法，只用于判断某个用户输入是否可以更新 `SOUL.md`、`USER.md` 或 `EXTENSION.md`。它不会注入普通对话 prompt，也不能由模型生成的更新编辑。

`README.md`、`README.zh.cn.md` 和 `config.jsonc` 是包元信息与设计参考，不是运行时 prompt section。
