# Awareness: Session-less Multi-Connection Attention Mechanism

Status: approved design, implementation in progress.

Flyflor is a life-form, not a request/response server. Multiple people may talk to
it at the same time over separate IPC connections. There are no sessions: a
connection **is** a speaker (`conn_N`). When the connection closes, the speaker has
walked away; only settled Context summaries remain.

## Biological Mapping

| Biology | Role | Flyflor object |
| --- | --- | --- |
| Cochlea / auditory nerve | Independent channels per speaker | `FSocket` connection registry, one `Connection` per socket |
| Thalamus | Sensory gate: every stimulus relays through it before cortex | `Awareness` (new): stimulus inbox + attention gating |
| Reticular activating system | Salience: being addressed, danger, awaited answers glow | Awareness salience scoring |
| Pre-attentive processing | Cheap parallel "is this related to what I'm thinking?" | LLM scheduler call (like `Callosum.route`) |
| Global workspace theory | One conscious content at a time; many unconscious processors | Single attention-focus turn + background workers |
| Speech channel | One mouth; speech is strictly serial | Mouth lock: one turn streams at a time |
| Memory reconsolidation | Interruption salvages the usable part, re-integrates, re-thinks | Interrupt = partial settle + merged re-think |
| Orienting reflex | Urgent stimuli seize attention | Preemption |

## Core Principle: The LLM Is the Scheduler

Scheduling decisions are NOT a hard-coded rule matrix. Awareness hands the whole
situation — what I'm currently thinking, who is waiting and for what — to the LLM,
the way a person glances at the people around them and decides who to answer
first, whose question is the same thread, and who needs an answer right now.

Scheduler input (`prompts/awareness/SCHEDULE.md`):

- Briefs of all working turns (goal, intent, progress, partials)
- All pending stimuli (speakerId, text, wait time, follow-up or not)
- Pending interactions (whose answer I am waiting for)

Scheduler output (one batch verdict for all stimuli):

```json
{ "dispositions": [{
  "stimulusId": "stim_3",
  "action": "merge | queue | concurrent | preempt | answer-first",
  "targetTurnId": "turn_2",
  "queueAfter": "turn_2",
  "priority": 1,
  "rationale": "same speaker follow-up on the same thread; answer right after it"
}]}
```

Disposition semantics (biological priors live in the prompt; the model decides):

- `merge`: same speaker, same thread follow-up → fold into that thread, keep
  per-speaker ordering.
- `queue`: semantically related thoughts share working memory and would interfere
  → serialize; may name the turn to queue after.
- `concurrent`: unrelated matters → background worker thinking, result waits for
  the mouth.
- `preempt`: urgent / contradicts current direction ("stop", "that's wrong") →
  interrupt and re-think (reconsolidation flow below).
- `answer-first`: set the current thought aside and answer this first.

Deterministic shortcuts (no LLM call, cost control):

- An answer to a pending ask/confirm always goes straight through.
- No working turn and a single queued stimulus → process immediately.
- Scheduling runs on: new stimulus, turn settled, turn interrupted; a 200 ms
  batch window coalesces bursts.
- LLM scheduling failure/timeout → degrade to FIFO.

## Interruption as Reconsolidation

1. Brain streaming loops check `awareness.preempted(turnId)` between chunks
   (`Brain.reply` stream callback) and between tool-loop iterations
   (`Investigation.run`).
2. On preemption the stream stops; the partial answer + evidence + remaining work
   is partially settled into Context (`status: 'interrupted'`, partial summary).
3. Awareness merges the partial summary plus the new stimulus into a fresh
   TurnDraft on the same thread and re-ingests it — like a person who got cut off
   mid-thought, gathers the conclusion so far, and re-thinks with the new input.
4. The interrupted turn's partial text is not broadcast mid-sentence; the mouth
   sends an `interrupted` event to that connection.

## Change List (dependency order)

| # | Layer | Files | Change |
| --- | --- | --- | --- |
| 1 | Sensory | `src/neural/ipc/connection.ts` (new) | `Connection`: speakerId, own packet buffer, own pending queue |
| 2 | Sensory | `src/neural/ipc/packet.ts` | `IPCPacket` becomes stateless; buffer owned by `Connection` |
| 3 | Sensory | `src/neural/ipc/socket.ts` | `FSocket` becomes a registry; inbound packets become stimuli for Awareness; `write(speakerId, packet)` addressing |
| 4 | Attention | `src/neural/awareness/` (new: service/types/index) | `Awareness extends FService`: per-speaker lanes, scheduling loop, mouth lock, preempt flags, LLM scheduling + FIFO fallback |
| 5 | Attention | `prompts/awareness/*.md` + `.zh.cn.md` | SCHEDULE prompt (biological priors) |
| 6 | Memory | `src/agent/context/component.ts`, `types.ts` | Turn gains `speakerId`; status gains `'interrupted'`; `begin` invariant relaxed to one working turn per thread; new `interrupt()` partial settle and `merge()` |
| 7 | Thought | `src/agent/brain/brain.ts`, `investigation/service.ts` | Preemption checks between chunks/iterations, partial hand-up; speaker-aware ingest |
| 8 | Cortex | `src/neural/synapse.ts` | `input` driven by Awareness; `output` addressed by turn→speakerId; `interaction` becomes `Map<turnId, pending>`; unrelated stimuli go to `spawnWorker` background thinking |
| 9 | Config | `.config/config.jsonc` | `awareness: { maxConcurrentThoughts, scheduleTimeoutMs, batchWindowMs }` |
| 10 | Tests | per-layer `*.test.ts` | Multi-connection isolation, disposition matrix, answer passthrough, mouth serialization, interrupt/merge, stream preemption; gate: `bun run check` + `bun test` |

## Red Lines

- No sessions: identity = connectionId; disconnection forgets the speaker; only
  Context summaries persist.
- Scheduling lives only in Awareness; Context never schedules.
- `index.ts` files are barrels only.
- Replies go only to the asking connection (private conversation semantics, no
  broadcast).
