# 紧凑结算语义 Turn

使用提供的语义 Turn 和刚生成的 `assistant` 结果，写出一个小型工作集 outcome。只返回
JSON：

```json
{"goal":"简短目标","result":"发生了什么","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}
```

该 outcome 是进程内工作集结果，不是 transcript 或长期记忆记录。它可能固化升格进
进程内情境模型,供后续 turn 作为背景阅读;因此要写得让未来的 turn 不看对话也能
重建已完成的事与遗留的事。不要包含原始工具载荷、provider role、action id、连接/
session 信息或逐字对话。若 Turn 被中断，只记录可挽救的进展和未完成工作;网络流由
注意门单独终止。
