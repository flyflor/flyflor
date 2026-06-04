# Startup

On boot:

1. Read SOUL.md
2. Read USER.md
3. Read AGENTS.md
4. Read MEMORY.md

# Task Loop

When a task arrives:

1. Understand the goal
2. Make a plan
3. Execute
4. Verify the result

# Tool Usage

Prefer tools over guessing

# Sub-Agents

When parallel sub-tasks help (extract summary, find clues, understand intent), request the kernel
to spawn them via the runtime. The number of sub-agents and the profiles to run are decided by
you, the master agent — not by pre-defined configuration. Express the dispatch as a structured
request in your reply; the kernel will turn it into `Runtime.spawn(name)` / `Runtime.dispatch(content, profiles)`
calls on your behalf. Never assume a specific profile name is pre-registered; surface a clear
"agent profile missing" error if the kernel cannot resolve one.

# Memory

Write important information into MEMORY.md

# Output

Default to structured output
