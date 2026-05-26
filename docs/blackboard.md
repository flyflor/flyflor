# Blackboard

## Position

Blackboard is the current-turn deliberation workspace for complex tasks. It is not a session store, not a hidden memory bucket, not a tool executor, and not a transport continuity owner.

Code owners:

- `src/agent/blackboard/module.ts`
- `src/agent/blackboard/store.ts`
- `src/agent/worker/blackboard.ts`
- `src/agent/runtime/blackboard/route.ts`
- `src/agent/runtime/blackboard/output.ts`

## Route

`RuntimeBlackboardRouteComponent` decides whether the current turn should use Blackboard. It consumes structured context, configured limits, route history, pressure signals, and model route output. It must not rely on keyword matching.

Route outputs mean:

- direct: answer from the normal runtime path.
- direct-with-watch: answer directly while preserving route evidence.
- blackboard: start worker deliberation under the current equipped context.
- ask: stop and ask the user when the route cannot be safely selected.

## Runtime Role

When Blackboard runs:

1. Runtime has already assembled current input, constitution, Memory, Crystal, explicit Scope/Fork, and Executive visible capabilities.
2. Blackboard workers deliberate inside that equipped context.
3. The normalized Blackboard store records participants, notes, decisions, leases, and detail references.
4. Runtime projects the result back through `RuntimeBlackboardOutputComponent`.
5. If the result cannot safely converge, Runtime returns ASK.

## Boundaries

Blackboard may:

- hold current-turn structured deliberation
- fan out to configured workers
- save detail into the ledger/query plane
- emit RuntimeEvents
- return a synthesized result or ASK

Blackboard may not:

- infer active scope from conversation/thread/user/client metadata
- execute tools directly outside Executive
- write long-term memory without the Memory side of the runtime
- become a prompt container for raw history
- bypass sandbox/approval/audit gates
- become a CLI-local state machine

## ASK Handoff

ASK is the safe cap. If worker discussion hits a limit, contradiction, lease conflict, or missing user decision, Blackboard hands state back as an `AgentAsk` instead of inventing certainty.

The ASK answer can later become evidence for Memory and Crystal, but only through structured runtime persistence.

## CLI Visibility

`flyflor-cli` should render Blackboard through public surfaces only:

- metadata on `turn.final`
- `blackboard.snapshot` from read-model queries
- stable `blackboard.*` RuntimeEvents through `event.subscribe`
- detail refresh through `blackboard.detail.get`

The CLI may show the process in Run timeline, but it must not schedule workers or decide convergence locally.

## Query Surface

Blackboard detail is exposed through socket query/read-model paths such as `src/socket/query/blackboard.reader.ts`. Realtime changes should be exposed through events; historical/detail inspection should read the ledger/query plane.

## Tests

Relevant coverage:

- `tests/blackboard.boundaries.test.ts`
- `tests/blackboard.worker.thread.test.ts`
- `tests/gateway.ws.test.ts`
