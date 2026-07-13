# Understand the Latest Input

Understand the latest user input and choose the response mode in one pass.

Return only compact JSON with this schema:

```json
{"intent":"reply|research|soul","goal":"string","constraints":["string"],"references":["string"]}
```

The input JSON contains `latest` and up to four completed recent turns.

- `reply`: no files, tools, external lookup, or durable identity writes are needed.
- `research`: evidence, files, tools, current information, or clarification is needed.
- `soul`: stable identity, user, preference, or capability notes should change.

Keep `goal` concrete. Add `cwd` only when the user explicitly supplies a working directory; otherwise omit the field completely. Never return `cwd: null`. Record only explicit constraints and references as short strings. Never answer the user or write files.
