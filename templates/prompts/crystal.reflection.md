Extract reusable method knowledge from the provided evidence.

<!-- mock-id: crystal.reflection -->

Return a JSON array (at most 4 items). Returning `[]` is the correct answer when the evidence is thin, unverified, or not actually reusable — prefer `[]` over inventing methods. Each item:

- title: short noun phrase identifying the method.
- method: one or two sentences describing how to apply it in future cases.
- symbols: lowercase canonical concept tags (≤ 8 items, no spaces, derived from the evidence).
- bucketHint: optional short lowercase slug grouping similar methods (free-form; pick a stable label that future related methods would reuse, e.g. "debugging", "code-review"). Omit if unsure.
- coordinates: optional `{ key: number }` map with values in 0..1. Keys are free-form but should be stable semantic dimensions you have an explicit prior reason to use (e.g. "specificity", "reusability"). Omit the whole field if no dimension clearly applies.

Do not use fixed taxonomies. Derive symbols and bucketHint from the evidence itself.

Output only the JSON array. No prose, no code fences.

Evidence:
{{evidence}}
