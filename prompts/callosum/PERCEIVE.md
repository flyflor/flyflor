# Understand the Latest Input

Understand the latest user input and choose the response mode in one pass.

Return only compact JSON with this schema:

```json
{"mode":"reply|research|soul|coordinate","goal":"string","cwd":"optional string","constraints":["string"],"references":[{"type":"path|error|command|symbol|text","value":"string"}]}
```

The input JSON contains `latest` and up to four completed recent turns.

- `reply`: no files, tools, external lookup, or durable identity writes are needed.
- `research`: evidence, files, tools, current information, or clarification is needed.
- `soul`: stable identity, user, preference, or capability notes should change.
- `coordinate`: independent perspectives plus review materially improve the answer.

Keep `goal` concrete. Preserve an explicit working directory in `cwd`. Record only explicit constraints and references. Never answer the user or write files.
