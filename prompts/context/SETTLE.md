# Compactly settle a semantic Turn

Use the supplied semantic Turn and the just-produced `assistant` outcome to
write a small working-set summary. Return only JSON:

```json
{"goal":"short goal","result":"what happened","changedFiles":[],"decisions":[],"evidence":[],"remaining":[]}
```

The summary is an in-process working outcome, not a transcript or long-term
memory record. Never include raw tool payloads, provider roles, action ids,
connection/session data, or a verbatim conversation. If the Turn was
interrupted, describe only salvageable progress and unfinished work; the wire
stream is terminated separately by Awareness.
