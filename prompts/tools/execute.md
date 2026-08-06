Use this tool to run agent-created scripts as one batch.

It is the execution orchestrator, not the environment exploration tool. Use it when the task needs script execution, ordered queues, or parallel task runs. Each task should point to a script path and declare its runtime. One call accepts at most 64 tasks and runs at most 8 tasks concurrently.
