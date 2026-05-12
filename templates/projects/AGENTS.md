# {{title}} Agent Guide

This file is shared context for AI coding agents working in this project.

## Goal

{{goal}}

## Working Rules

- Keep project-local capability state under `.flyflor/`.
- Prefer explicit, reviewable changes over hidden tool behavior.
- Do not store secrets, logs, runtime databases, or user-private data in this project.
- Keep semantic decisions model-driven; do not replace intent, routing, memory, or feedback decisions with keyword matching.
- Update `TODO.md` when work changes scope or status.

## Project Metadata

- Project id: `{{projectId}}`
- Originating user: `{{userId}}`
- Created at: `{{createdAt}}`
- Trigger: `{{trigger}}`
- Related episode ids: {{relatedIds}}
