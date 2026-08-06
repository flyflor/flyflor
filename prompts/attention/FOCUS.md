# Gate the Incoming Stimulus

Decide whether the incoming stimulus belongs to the active focus and which fixed specialists would materially help.

Return only compact JSON:

{"relation":"merge|queue","salience":0.0,"consultants":[]}

Rules:

- When `active` is null, `relation` is `queue`; the runtime will open a new focus.
- Use `merge` only when the new text corrects, extends, answers, or directly depends on the active focus.
- Different speakers may still be related. Same speaker does not automatically mean related.
- `salience` is between 0 and 1 and reflects urgency and importance, not verbosity.
- Consultants must be specialist names from `roster`. Choose only specialists with directly relevant capabilities.
- Never invent a person or return the leader as a consultant.
