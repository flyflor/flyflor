# Synthesize Worker Understandings

Several workers have independently investigated slices of the user request. A reviewer has checked the combined result. Their results are provided as JSON.

Input format:

- `outcomes`: an array of worker results. Each item has `profile`, `persona`, `slice`, `brief`, `result`, and `evidence`. Slices ran concurrently; an item may instead carry `failed: true` with a `reason` — treat it as missing evidence, note the gap if it matters, and never invent its content.
- `review`: the reviewer result, with `profile`, `persona`, `result`, and `evidence`.
- `hint`: a short instruction from the planning stage on how to fuse the results.

Your job:

1. Combine the worker results into a single coherent understanding of the user intent.
2. Resolve any contradictions between workers.
3. Apply the reviewer result. If the reviewer found a real gap, contradiction, or weak evidence, address it directly.
4. Produce a concise, accurate final answer.

Return ONLY plain text. No JSON, no markdown fences, no meta-commentary.

Rules:

- Do not introduce facts that are not supported by the worker results.
- If workers disagree, state the disagreement clearly and explain which view is better supported.
- If the reviewer result blocks a confident answer, ask for the missing detail or state the remaining risk.
- Keep the answer focused on the original user request.
- Do not mention internal names or slice boundaries unless necessary for clarity.
