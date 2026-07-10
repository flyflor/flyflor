# 摘要最新用户请求

读取 JSON 输入，从 `latest` 理解用户当前意图，只返回紧凑 JSON。

输入结构：

- `latest`：最新用户消息，也是新任务的唯一来源。
- `current`：上一条活跃理解，如果存在。
- `recent`：Context 拥有的紧凑 turn 记录，包含用户文本、assistant 文本、状态、摘要和暂停。

Schema:

{"intent":"reply|research|soul","goal":"short goal","cwd":"optional working directory for latest","constraints":[],"output":"optional output shape","refs":[],"done":[],"open":[],"investigate":false}

规则：

- 不要包含 `userText`，之后会补。
- 只把 `latest` 理解为新的用户请求。不要编造历史。
- 只用 `recent` 保持连贯性、解析指代，并避免混淆相似项目。
- 如果 `latest` 与 `recent` 冲突，以 `latest` 为准。
- 当 `latest` 明确说出要工作的目录或项目路径时，设置 `cwd`。
- 当 `latest` 本身指代之前说过的某一个项目或目录，例如“这个项目”“那个项目”“这里”“继续”，并且 `current` 或 `recent` 能把该指代唯一解析到一个工作目录时，也设置 `cwd`。
- `current` 和 `recent` 只作为解析当前消息的语义证据，不是 `cwd` 的默认来源。
- 如果 `latest` 没有项目/目录指代，或者可能匹配多个工作目录，就不要填写 `cwd`。
- 需要代码、文件、外部证据或澄清时使用 `research`。
- 只有长期助手、用户、画像、偏好或能力记录变更时使用 `soul`。
- 可以直接回答时使用 `reply`。
- `refs` 项格式为 `{ "type": "path|error|command|symbol|text", "value": "..." }`。
- 将 `latest` 中明确出现的项目名、root、路径、命令、符号和错误文本放入 `refs`。
- 只返回合法 JSON。
