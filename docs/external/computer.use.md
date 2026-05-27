# Computer Use External Tool

`computer.use` is the high-level desktop-control facade for the external tool layer. It is inspired by the Hermes computer-use schema, but Flyflor keeps execution outside the kernel through process-json sidecars.

## Owner Boundary

- Descriptor owner: `src/executive/external/tools.ts`.
- Process-json sidecar owner: `scripts/computer.use.sidecar.ts`.
- Native observation/action adapter owner: `scripts/computer.native.sidecar.ts`.
- Installer and registry owners: `tools/init.*`, `scripts/install.xtools.computer-use.sh`, and `tools/external.tools.jsonc`.

The kernel owns visibility, approval, quota, event, and audit boundaries. Desktop control payloads run in child processes.

## Action Schema

`computer.use` accepts a compact `action` discriminator:

- Observation: `capture`, `wait`, `list_apps`.
- Pointer actions: `click`, `double_click`, `right_click`, `middle_click`, `drag`, `scroll`.
- Keyboard and value actions: `type`, `key`, `set_value`.
- App routing: `focus_app`.

Hermes-style capture and targeting fields are supported:

- `mode`: `som`, `vision`, or `ax`.
- `maxElements`: cap for dense accessibility trees.
- `element` or `coordinate` for point targets.
- `fromElement` / `toElement` or `fromCoordinate` / `toCoordinate` for drag.
- `button`, `modifiers`, `seconds`, and `raiseWindow`.
- `captureAfter` to run a follow-up capture after a mutating action.

The sidecar also normalizes these fields into snake_case payload keys for CUA-style delegates.

## Safety Semantics

Read-only actions are marked as observation. Mutating actions remain computer-control capabilities and must stay behind Executive approval, quota, and audit gates.

Hard blocks are enforced before a delegate is spawned:

- Dangerous shell install/delete text typed through `type`.
- Destructive system key combinations such as forced logout or trash deletion.

Missing delegates return structured `unavailable`; failed delegates return structured `failed`.
