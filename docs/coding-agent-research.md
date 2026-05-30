# Flyflor Coding Agent Research Report

## Purpose

This document records the implementation constraints derived from the local reference projects. It is not a product overview. Runtime work must use these findings as engineering requirements.

## Codex Findings

Codex treats context as a structured history that can be rewritten safely. The important mechanism is not a short rolling summary:

- It preserves tool call and tool output invariants while trimming or compacting history.
- It performs pre-turn and mid-turn compaction when a follow-up model step still needs context budget.
- It distinguishes regular user context from injected initial context during compaction.
- It keeps reference context so large baseline instructions can be represented as a baseline plus newer updates.
- It records compact traces and handles retry/backoff when context-window failures happen.

Flyflor requirement: context compaction must be a history-rewrite system with source ids, checkpoint records, and tool-boundary protection.

## OpenCode Findings

OpenCode exposes tools as typed runtime objects and lets the LLM loop continue after tool calls:

- Tools have descriptions, parameter schemas, success shapes, and optional external schemas.
- The LLM runtime streams text, reasoning, tool input deltas, tool calls, tool results, provider metadata, and usage.
- Tool execution can be concurrent when safe and sequential when a tool mutates state.
- Plugin hooks mutate controlled outputs through typed hook contracts, not ad hoc callbacks.

Flyflor requirement: the model provider must support OpenAI-compatible `tool_calls`, and the kernel must run a real model/tool loop.

## Claude Code Findings

Claude Code's strength is work organization:

- Exploration, architecture, implementation, and review are separate roles.
- Multiple agents inspect different paths and produce handoff summaries.
- Review agents report high-confidence findings instead of dumping speculative advice.
- Multi-edit workflows validate all replacements before committing changes.

Flyflor requirement: `TaskTool` and workmux lanes must be visible, scoped, and reviewable; multi-edit must be atomic.

## OpenHuman Findings

OpenHuman treats memory as a system, not a chat log:

- Documents, lightweight writes, full ingestion, namespaces, graph upserts, and recall APIs are separate.
- Background jobs extract entities and relations after memory writes.
- Token compression applies before noisy tool output enters model context.
- Subconscious/background work produces situation reports and recovery-oriented state.

Flyflor requirement: `memory.db` must contain facts, claims, decisions, tasks, entities, relations, chunks, embeddings, retrieval traces, and recovery state. `brain.db` must retain full audit data so memory can be rebuilt.

## Final Architectural Consequence

Flyflor is built around three persistence layers:

- `brain.db`: full monthly audit biography, no compression.
- `memory.db`: hot working memory, retrieval, graph, checkpoint, recovery.
- artifacts: raw large files and tool/model outputs referenced by both databases.

The kernel must never answer coding tasks by asking the user to provide files that the local tools can inspect. It must explore through read, grep, glob, shell, CodeGraph, RTK, memory, and visible sub-agent lanes.
