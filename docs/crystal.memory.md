# Crystal Memory

Crystal Memory is the reflection layer for reusable method knowledge. It must not be a fixed taxonomy or keyword classifier.

## Philosophy

Flyflor treats the LLM as **fluid intelligence** and reflection as **crystallized intelligence**.

- Fluid intelligence handles the current turn: understanding, reasoning, tool use, code work, and natural language output.
- Crystallized intelligence is formed only after reflection extracts a reusable method from evidence and the controller validates that evidence.
- SurrealDB is the internal associative memory space. It stores candidates, atoms, skills, and graph relations so future questions can wake nearby methods instead of relying on one flat keyword match.

The goal is a hippocampus-like recall network:

1. A difficult turn produces reflection candidates.
2. Evidence-backed candidates become small atoms.
3. Repeated or strong atoms merge into skills.
4. Skills connect through graph edges and spatial coordinates.
5. Future queries activate nearby symbols, relations, and skills within a latency budget.

Future forgetting and reinforcement will update the network. A skill that is reused successfully should become easier to wake. A stale, contradicted, or unused skill should decay unless it is protected by high-risk or user-confirmed evidence.

## Rules

- Reflection workers produce `title`, `method`, `symbols`, `bucketHint`, and `coordinates` from evidence.
- Source code does not define semantic buckets, domain keywords, or methodology categories.
- The short extraction prompt lives in `templates/prompts/crystal.reflection.md`; the Chinese file is only a review copy.
- Evidence scores come from verified source records, not from model confidence alone.
- SurrealDB stores candidates, atoms, skills, and later graph edges as internal infrastructure. It is not exposed to the host.
- Runtime and Blackboard reflection must enter as candidates first. Candidates with zero evidence are persisted for audit but do not become atoms or skills.
- Graph clustering is emergent from symbols, coordinates, evidence, reuse, and relation edges. It is not a compiled-in enum list.
- Crystal skills are method hints, not facts and not instructions. They can guide planning, but they cannot override system, developer, or current user instructions.

## Flow

```text
verified evidence or blackboard transcript
  -> reflection worker extracts symbols/bucketHint/coordinates
  -> controller writes a reflection candidate
  -> controller validates structure and evidence
  -> atom is persisted
  -> repeated or strong atoms merge into a crystal skill
  -> recall ranks skills by dynamic symbol overlap, bucket relation, coordinate similarity, and evidence confidence
```

## Data Model

| Unit                 | Purpose                                                                                                        | Current status |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | -------------- |
| Reflection candidate | Auditable proposal extracted from a turn, blackboard transcript, history entry, or verified file/tool evidence | Implemented    |
| Reflection atom      | Smallest reusable method unit with evidence                                                                    | Implemented    |
| Crystal skill        | Stable method formed by strong or repeated atoms                                                               | Implemented    |
| Graph edge           | Relationship such as `supports`, `refines`, `contradicts`, `verified_by`, `used_by`, `failed_in`               | Pending        |
| Cluster              | Dynamic neighborhood formed by coordinates, symbols, relation edges, and feedback                              | Pending        |
| Recall trace         | Record of why a skill was woken and whether it helped                                                          | Pending        |
| Forgetting state     | Decay/reinforcement metadata for old, stale, failed, or confirmed skills                                       | Pending        |

## Current Implementation

- `RuntimeModule` can call `crystal.reflection.md` after a routed turn when reflection is required.
- `CrystalMemoryService.recordTurn` accepts explicit reflection candidates in addition to promoted memory and history evidence.
- Evidence-backed candidates crystallize into atoms/skills.
- Direct or garbage candidates with zero evidence remain candidates only.
- `bun run test:reflection:stress` reports candidate count, atom/skill count, recall hits, and garbage crystallization.

## Next Steps

| Priority | Workstream                   | Next                                                                                                                                 |
| -------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| P1       | Graph edges                  | Add SurrealDB relations between candidates, atoms, skills, blackboard turns, worker steps, source evidence, and verification events. |
| P1       | Recall traces                | Persist why a skill was woken, which graph path contributed, and whether the method helped or failed.                                |
| P1       | Deep activation              | Implement query -> seed skills -> graph expansion -> budgeted rerank with hop, top-k, timeout, and cache limits.                     |
| P1       | Forgetting and reinforcement | Add decay, reuse, failure, and protected-state fields without deleting audit records.                                                |
| P2       | Background reflection        | Move reflection extraction to a schedulable worker so the hot turn path stays predictable.                                           |
| P3       | Inspection views             | Add CLI/TUI views for candidates, atoms, skills, graph edges, recall traces, and garbage-candidate audits.                           |

## Risk Warnings

| Risk                     | Why it matters                                            | Required guard                                                                      |
| ------------------------ | --------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Hardcoded buckets return | Recall becomes brittle and violates the design philosophy | Source must not contain fixed domain buckets or keyword maps                        |
| Zero-evidence promotion  | Hallucinated skills will poison later planning            | Candidate-only audit is allowed; atom/skill promotion requires evidence             |
| Prompt drift             | Reflection extraction may stop producing stable structure | Keep necessary prompts in Markdown templates and validate output schema             |
| Slow deep activation     | Graph expansion can add latency to every chat turn        | Use top-k, timeout, hop limits, and cached rank signals                             |
| Memory pollution         | Session chatter can turn into fake methodology            | Only verified candidates can crystallize                                            |
| Over-decay               | Rare but critical safety methods may disappear            | Protect high-risk, user-confirmed, or failure-derived methods from aggressive decay |
