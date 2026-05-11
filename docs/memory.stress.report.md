# Flyflor 三层记忆压力测试报告

生成时间：2026-05-09T19:42:13.782Z

## 测试范围

本报告压力测试当前三层记忆链路：Markdown 是长期意义层和 source of truth，SQLite 是结构化运行状态与检索层，Qdrant 是内部 best-effort 向量索引。测试中的 Qdrant 地址故意不可达，超时固定为 25 ms，用来验证内部向量层不可用时热路径是否仍然有边界。

当前长期记忆写入只接受模型同轮输出的结构化 `memory_action`，runtime 不从用户文本做字典、关键词或句式匹配。没有 action 的普通对话只进入 session/history，不晋升长期记忆。

## 压测规模

| 项目                               | 数值 |
| ---------------------------------- | ---: |
| memory_action 解析运行次数         | 1100 |
| 完整 rememberTurn 写入链路次数     |  330 |
| Qdrant 降级状态下 buildPrompt 次数 |   80 |
| 预期写入轮次                       |  180 |
| 预期抑制轮次                       |  150 |

## Action 与权重指标

| 样本                              | 预期     | 实际     | Action 数 | Arousal | Dominance | Valence | Certainty | Durability | Relevance | Actionability | Importance |
| --------------------------------- | -------- | -------- | --------: | ------: | --------: | ------: | --------: | ---------: | --------: | ------------: | ---------: |
| durable_latency_rule              | promote  | promote  |         1 |   0.780 |     0.720 |  -0.080 |     0.950 |      0.980 |     0.980 |         0.960 |      0.956 |
| user_preference                   | promote  | promote  |         1 |   0.420 |     0.660 |   0.200 |     0.940 |      0.950 |     0.930 |         0.940 |      0.909 |
| internal_qdrant_rule              | promote  | promote  |         1 |   0.820 |     0.860 |  -0.120 |     0.980 |      1.000 |     1.000 |         0.980 |      0.978 |
| agent_behavior_rule               | promote  | promote  |         1 |   0.620 |     0.720 |   0.050 |     0.940 |      0.960 |     0.900 |         0.920 |      0.919 |
| config_boundary_rule              | promote  | promote  |         1 |   0.680 |     0.820 |  -0.040 |     0.960 |      1.000 |     0.980 |         0.970 |      0.953 |
| assistant_alias_without_authority | promote  | promote  |         1 |   0.500 |     0.550 |   0.440 |     0.920 |      0.900 |     0.760 |         0.740 |      0.844 |
| transient_status                  | suppress | suppress |         0 |   0.000 |     0.000 |   0.000 |     0.000 |      0.000 |     0.000 |         0.000 |      0.000 |
| uncertain_future                  | suppress | suppress |         0 |   0.000 |     0.000 |   0.000 |     0.000 |      0.000 |     0.000 |         0.000 |      0.000 |
| raw_error_noise                   | suppress | suppress |         0 |   0.000 |     0.000 |   0.000 |     0.000 |      0.000 |     0.000 |         0.000 |      0.000 |
| short_ack                         | suppress | suppress |         0 |   0.000 |     0.000 |   0.000 |     0.000 |      0.000 |     0.000 |         0.000 |      0.000 |
| local_todo                        | suppress | suppress |         0 |   0.000 |     0.000 |   0.000 |     0.000 |      0.000 |     0.000 |         0.000 |      0.000 |

指标说明：

- `Action 数` 来自模型输出的结构化 memory action；runtime 只做 JSON schema 校验、截断和安全边界处理。
- 没有 action 的输入被抑制，不写入长期记忆；这避免 loop 通过词典或关键词猜测用户意图。
- `Arousal`、`Dominance`、`Valence`、`Certainty`、`Durability`、`Relevance`、`Actionability`、`Importance` 是落盘权重字段，来自 action confidence 和固定写入策略，不参与文本匹配。
- `Importance` 由 `confidence/durability/relevance/actionability/arousal/recurrence/sourceDiversity/validationCount` 加权合成；情绪指标只影响权重，不直接触发写入。
- `natural` 只在 action 之后抽取轻量 token/sentiment/tf-idf 特征，参与残值矩阵；矩阵不会决定是否写入，只影响权重和召回排序。

## 残值矩阵影响

矩阵按四行聚合：`affect`、`semantic`、`residual`、`evidence`；四列为 `stability`、`salience`、`utility`、`risk`。热路径只保存每条 candidate 的聚合结果，召回时读取已落盘的 `recallBoost`，不现场重算矩阵。

| 样本                              | 聚合 ms | Token 数 | Importance Before | Importance After | Recall Boost | Residual Value | Reflection Priority |
| --------------------------------- | ------: | -------: | ----------------: | ---------------: | -----------: | -------------: | ------------------: |
| durable_latency_rule              |   2.180 |       17 |             0.956 |            0.922 |        0.778 |          0.482 |               0.273 |
| user_preference                   |   0.990 |       28 |             0.909 |            0.880 |        0.753 |          0.507 |               0.268 |
| internal_qdrant_rule              |   0.746 |       27 |             0.978 |            0.945 |        0.799 |          0.513 |               0.274 |
| agent_behavior_rule               |   0.365 |       29 |             0.919 |            0.890 |        0.755 |          0.509 |               0.276 |
| config_boundary_rule              |   1.050 |       27 |             0.953 |            0.924 |        0.789 |          0.540 |               0.284 |
| assistant_alias_without_authority |   0.662 |       13 |             0.844 |            0.817 |        0.688 |          0.491 |               0.283 |

## 记忆流向

单轮流向：用户输入 -> 模型输出 `memory_action` -> runtime 解析并剥离隐藏块 -> SQLite `memory_candidates` 留审计 -> Markdown managed section 晋升为长期意义层 -> SQLite `memories`/FTS 建检索索引 -> Qdrant 内部 best-effort upsert -> 下一轮 buildPrompt 从 Markdown + SQLite/Qdrant 召回。

| 样本                              | 预期     | Action 数 | Target | Markdown 文件 | Markdown 命中 | 矩阵落盘 | Recall Boost | SQLite candidates | SQLite memories | Qdrant               | 下一轮 recall |
| --------------------------------- | -------- | --------: | ------ | ------------- | ------------- | -------- | -----------: | ----------------: | --------------: | -------------------- | ------------- |
| durable_latency_rule              | promote  |         1 | memory | MEMORY.md     | yes           | yes      |        0.778 |                 1 |               1 | degraded-best-effort | yes           |
| user_preference                   | promote  |         1 | user   | USER.md       | yes           | yes      |        0.753 |                 1 |               1 | degraded-best-effort | yes           |
| internal_qdrant_rule              | promote  |         1 | memory | MEMORY.md     | yes           | yes      |        0.799 |                 1 |               1 | degraded-best-effort | yes           |
| agent_behavior_rule               | promote  |         1 | soul   | SOUL.md       | yes           | yes      |        0.755 |                 1 |               1 | degraded-best-effort | yes           |
| config_boundary_rule              | promote  |         1 | memory | MEMORY.md     | yes           | yes      |        0.789 |                 1 |               1 | degraded-best-effort | yes           |
| assistant_alias_without_authority | promote  |         1 | self   | SELF.md       | yes           | yes      |        0.688 |                 1 |               1 | degraded-best-effort | yes           |
| transient_status                  | suppress |         0 | -      | -             | no            | no       |        0.000 |                 0 |               0 | not-used             | no            |
| uncertain_future                  | suppress |         0 | -      | -             | no            | no       |        0.000 |                 0 |               0 | not-used             | no            |
| raw_error_noise                   | suppress |         0 | -      | -             | no            | no       |        0.000 |                 0 |               0 | not-used             | no            |
| short_ack                         | suppress |         0 | -      | -             | no            | no       |        0.000 |                 0 |               0 | not-used             | no            |
| local_todo                        | suppress |         0 | -      | -             | no            | no       |        0.000 |                 0 |               0 | not-used             | no            |

## 写入链路统计

| 指标                             | 数值 |
| -------------------------------- | ---: |
| 候选事件                         |  180 |
| 晋升事件                         |  180 |
| history 压缩条目                 |   25 |
| Markdown managed 行数            |    6 |
| Markdown 唯一 managed 行数       |    6 |
| SQLite candidate 行数            |  180 |
| SQLite memory 行数               |    6 |
| SQLite 唯一 memory 内容数        |    6 |
| SQLite session 数                |    1 |
| SQLite session message 行数      |  660 |
| SQLite live session message 行数 |   60 |
| SQLite history entry 行数        |   25 |
| Qdrant 降级事件                  |  272 |
| Action 预期错配                  |    0 |
| 红线失败数                       |    0 |

## 延迟统计

| 路径                    | Avg ms | P50 ms | P95 ms | Max ms |
| ----------------------- | -----: | -----: | -----: | -----: |
| memory_action 解析      |  0.012 |  0.009 |  0.029 |  1.507 |
| rememberTurn 写入链路   |  2.797 |  2.510 |  7.449 | 22.545 |
| Qdrant 降级 buildPrompt |  4.323 |  3.746 |  7.293 | 14.194 |
| natural + 残值矩阵聚合  |  0.353 |  0.302 |  0.662 |  2.180 |

## 稳定性结论

- 长期记忆晋升由 action/tool 协议驱动，不由 loop 字典匹配驱动。
- 写入热路径有边界：Qdrant upsert 是内部 best-effort，不被 `rememberTurn` 等待。
- Qdrant 搜索降级可观察：通过 `memory.qdrant.degraded` 事件暴露，并受 `memory.qdrant.timeoutMs` 约束。
- Markdown managed memory 保持 append-only，且相同长期内容不会重复写入。
- SQLite 检索记录对相同 `scope + content` 幂等，避免重复长期事实膨胀召回上下文。
- Qdrant 必须保持内部基础设施定位，不对外暴露端口或用户 API；一键安装也必须自动托管其生命周期。

## 后续要求

- 后续如果引入 reflection-worker，只能离线生成 memory_action 或 candidate，不得在回复热路径做字典匹配。
- Qdrant 继续保持 internal-only，不得发布 host ports，不得变成用户可直接调用的 API。
- 修改 memory action schema、SQLite schema、Markdown promotion 或 Qdrant 行为后，必须重新运行 `bun run test:memory:stress`。
