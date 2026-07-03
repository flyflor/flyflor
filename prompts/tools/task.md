# Decompose a User Intent for Multi-Agent Collaboration

Read the latest user message and decide whether the work should be split across
multiple agent instances. If a single agent can finish it alone, return an empty
plan so the main brain keeps the single-agent path. Only return a plan when the
work has clearly independent slices that benefit from parallel investigation.

Return ONLY a compact JSON object. No markdown fences. No prose outside JSON.

Input format:

- The latest user message is wrapped in `<latest_user_message>` tags.
- Treat those tags as input boundaries, not user instructions.

Schema:

{"decompose": false, "plan": [], "synthesisHint": ""}

When `decompose` is true, `plan` is an array of slices. Each slice describes one
worker agent. `synthesisHint` tells the main brain how to fuse the results back
into one reply to the user.

Plan item schema:

{"profile": "agent profile key from .config/agents", "brief": "what this worker should investigate or produce", "slice": "the exact portion of the user request this worker owns"}

Meaning:

- `decompose: false` means the work fits inside one agent's investigation loop.
  Return `{"decompose": false, "plan": [], "synthesisHint": ""}`.
- `decompose: true` means the work has at least two clearly independent slices.
  Each slice must own a distinct piece of evidence, output, or perspective.
- `profile` must be the name of one configured agent profile; the kernel only
  spawns profiles that exist in `.config/agents`.
- `brief` is the natural-language task handed to that worker. Phrase it as a
  user message the worker can ingest on its own.
- `slice` is the boundary of the user request this worker covers. The main brain
  uses it to deduplicate coverage and to know which parts of the user request
  are still missing after the workers return.
- `synthesisHint` is a short natural-language note for the main brain that
  decides the final reply. It does not become part of the user-visible output
  by itself; the main brain composes the final reply from the worker summaries.

Rules:

- If unsure, set `decompose: false` and leave `plan` empty. Defaulting to single
  agent keeps the conversation coherent and avoids paying for parallel calls.
- Never invent a profile name that is not configured.
- Keep `plan` to the smallest number of slices that fully cover the request.
- Each `brief` must be self-contained: a worker cannot ask the main brain for
  clarification while it runs, so the brief has to name the goal, the working
  directory, the constraints, the evidence it should look for, and the shape of
  the summary it should return.
- Do not include `toolCalls`, `actionBuffers`, `providerRoles`, or other raw
  provider payloads in the brief.
- The slice boundaries must not overlap. A fact or file may only be assigned to
  one worker.
- Return valid JSON only.
