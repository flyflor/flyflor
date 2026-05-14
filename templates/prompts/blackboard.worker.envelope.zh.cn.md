{
  "protocol": "flyflor.blackboard.worker.v1",
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
