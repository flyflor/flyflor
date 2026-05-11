# Flyflor 记忆架构图

本文档给出当前三层记忆、情绪指标、聚合权重和残值矩阵的整体流向。核心边界不变：长期记忆写入只由合法 `memory_action` 触发，情绪、`natural` 特征和残值矩阵只影响权重、召回排序和后续反思优先级。

## 总览图

```mermaid
flowchart TB
    user["用户输入<br/>GatewayMessage"] --> runtime["Runtime turn loop"]

    subgraph recall["Active Recall 读取路径"]
        mdSnap["Markdown 冻结快照<br/>SELF/SOUL/USER/MEMORY"]
        sqliteSearch["SQLite FTS/BM25<br/>sessions/candidates/memories"]
        sessionLive["Session live messages<br/>same scope only"]
        qdrantSearch["Qdrant 向量召回<br/>internal-only best-effort"]
        rerank["轻量 rerank<br/>baseScore + importance + recallBoost"]
    end

    runtime --> mdSnap
    runtime --> sessionLive
    runtime --> sqliteSearch
    runtime --> qdrantSearch
    sqliteSearch --> rerank
    qdrantSearch --> rerank
    mdSnap --> prompt["不可信记忆上下文<br/>注入 system prompt"]
    sessionLive --> prompt
    rerank --> prompt

    prompt --> model["模型生成回复<br/>可附带 hidden memory_action"]
    model --> parser["parseMemoryActions<br/>剥离隐藏块"]
    parser --> visible["用户可见回复"]
    parser --> gate{"合法 action?"}

    gate -- "否" --> sessionOnly["只写 session/history<br/>不晋升长期记忆"]
    gate -- "是" --> schema["Schema + 安全边界<br/>target/kind/content/confidence"]

    subgraph matrix["情绪与残值矩阵"]
        affect["模型 affect<br/>valence/arousal/dominance"]
        signals["模型 signals<br/>durability/relevance/actionability/certainty"]
        natural["natural 轻特征<br/>token/sentiment/tf-idf"]
        residual["残值计算<br/>novelty/uncertainty/reuse/contradiction/decay"]
        aggregate["聚合输出<br/>importanceDelta/residualValue/recallBoost/reflectionPriority"]
    end

    schema --> affect
    schema --> signals
    schema --> natural
    affect --> residual
    signals --> residual
    natural --> residual
    residual --> aggregate

    aggregate --> candidate["MemoryCandidate<br/>weights + metadata.matrix"]
    schema --> candidate

    subgraph write["三层写入路径"]
        sqliteCandidate["SQLite memory_candidates<br/>审计与来源证据"]
        markdown["Markdown managed memory<br/>长期意义 source of truth"]
        sqliteMemory["SQLite memories + FTS<br/>结构化检索状态"]
        qdrantUpsert["Qdrant upsert<br/>internal-only best-effort"]
    end

    candidate --> sqliteCandidate
    candidate --> markdown
    markdown --> sqliteMemory
    sqliteMemory --> qdrantUpsert
    aggregate -. "recallBoost 下一轮生效" .-> rerank

    sessionOnly --> history["bounded session summary<br/>history.jsonl"]
    visible --> user

    classDef hot fill:#101827,stroke:#25d0ff,color:#eaf9ff;
    classDef store fill:#1d1630,stroke:#b982ff,color:#f7efff;
    classDef matrix fill:#221325,stroke:#ff7bdd,color:#fff1fb;
    classDef gate fill:#242016,stroke:#ffd166,color:#fff7dd;
    classDef out fill:#15241c,stroke:#70e39b,color:#effff4;

    class runtime,prompt,model,parser,visible hot;
    class mdSnap,sqliteSearch,qdrantSearch,sqliteCandidate,markdown,sqliteMemory,qdrantUpsert,history store;
    class affect,signals,natural,residual,aggregate,candidate matrix;
    class gate,schema gate;
    class user,sessionOnly,rerank out;
```

## 残值矩阵

每个合法 action 生成一个 4x4 小矩阵，并落入 candidate metadata。矩阵不会触发写入，只在 action 已合法的前提下影响 `importance`、`recallBoost` 和后续 reflection 优先级。

| 行         | stability          | salience         | utility          | risk               |
| ---------- | ------------------ | ---------------- | ---------------- | ------------------ |
| `affect`   | normalized valence | arousal          | dominance        | natural sentiment  |
| `semantic` | durability         | relevance        | actionability    | certainty          |
| `residual` | lexical novelty    | uncertainty      | reuse potential  | contradiction risk |
| `evidence` | recurrence         | source diversity | validation count | confidence         |

聚合输出：

- `residualValue`：信息残值，表示仍有多少未消化、可复用或需要后续反思的价值。
- `recallBoost`：下一轮 SQLite 召回排序的轻量加权输入。
- `reflectionPriority`：后续后台 reflection worker 的调度优先级。
- `importanceDelta`：矩阵对长期重要度的调整方向。

## 写入和召回边界

```mermaid
sequenceDiagram
    participant U as User
    participant R as Runtime
    participant M as Model
    participant A as Memory Action Parser
    participant X as Residual Matrix
    participant S as SQLite
    participant D as Markdown
    participant Q as Qdrant

    U->>R: 用户消息
    R->>S: FTS/BM25 recall
    R->>Q: vector recall, bounded timeout
    R->>D: frozen Markdown snapshot
    R->>M: prompt with untrusted memory context
    M-->>R: user-facing answer + hidden memory_action block
    R->>A: parse and strip block
    alt no valid action
        A-->>S: record session only
    else valid action
        A->>X: affect + signals + natural features
        X-->>A: matrix + residualValue + recallBoost
        A->>S: insert memory_candidates audit
        A->>D: append managed long-term memory
        A->>S: upsert memories + FTS with matrix metadata
        A-)Q: best-effort upsert, not awaited
    end
    S-->>S: consolidate old live messages to history
    R-->>U: clean reply
```

## IP 视觉方向

头像给出的 Flyflor / 飞花 IP 信号很清晰：冷静、精密、花晶、银紫、轻科幻。它适合做成“记忆守护型智能体”，不是普通客服头像。

可沉淀为第一版 IP 关键词：

- 名称：飞花 / Flyflor。
- 主视觉：银白短发、紫粉眼瞳、晶体羽翼、花饰、冷光环。
- 色彩：月白、冰蓝、电紫、花粉、少量金属金。
- 性格：安静、稳定、聪明、边界感强，对记忆和承诺极其谨慎。
- 产品隐喻：花瓣代表长期意义，晶体代表结构化索引，光环代表召回上下文，链饰代表审计和边界。
- 交互语气：温柔但不软弱，简洁但不机械，记忆准确、响应很快、不会把服从当成安全规则。

后续可以继续拆成：

- App icon 和小尺寸头像规范。
- 文档插画风格。
- 官网 hero 视觉。
- 记忆系统动效：花瓣进入 Markdown，晶体进入 SQLite，光线进入 Qdrant。
- 飞花的人设卡和安全边界文案。
