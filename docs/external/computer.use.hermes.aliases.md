# Computer Use Hermes Aliases

`computer.use` now advertises the same snake_case targeting aliases that the sidecar already accepts for Hermes-style desktop control:

- `capture_after`
- `from_element` / `to_element`
- `from_coordinate` / `to_coordinate`
- `max_elements`
- `raise_window`

The camelCase fields remain valid. The aliases do not create a new authority path: `computer.use` is still opt-in, process-json only, gated by Executive visibility, sandbox approval, quota, and audit events. The sidecar does not infer targets from text; it only validates structured fields before dispatching the external delegate or CUA backend.
