下面的 JSON 是黑板 worker 的输入 envelope。字段名保持英文协议键，中文副本只用于审查字段装配关系，不改变运行时契约。

{
  "goal": {{goalJson}},
  "round": {{roundJson}},
  "minRounds": {{minRoundsJson}},
  "phase": {{phaseJson}},
  "participant": {{participantJson}},
  "contract": {{contractJson}},
  "discussionPlan": {{discussionPlanJson}},
  "convergencePolicy": {{convergencePolicyJson}},
  "currentRoundSteps": {{currentRoundStepsJson}},
  "previousSteps": {{previousStepsJson}},
  "expectedOutput": [
    "inputSummary",
    "outputSummary",
    "newFacts",
    "blockers",
    "risk",
    "questions",
    "answers",
    "agreement",
    "outcome",
    "openIssues",
    "proposal",
    "discussion"
  ],
  "constraints": [
    "no-tool-execution",
    "no-long-term-memory-write",
    "surface-blockers",
    "write-public-discussion-as-dialogue",
    "answer-current-round-peer-questions"
  ]
}
