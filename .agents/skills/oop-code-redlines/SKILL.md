---
name: oop-code-redlines
description: Use when writing, reviewing, refactoring, debugging, testing, or documenting code where the user wants strict OOP boundaries, controlled Composition API usage, semantic directory/file naming, disciplined method bodies, and no procedural business-code sprawl.
---

# OOP Code Redlines

Use this skill as the default engineering discipline for codebases that should stay object-led, readable, and hard to turn into procedural clutter.

## Core Positioning

Code is organized around objects with names, ownership, lifecycle, and boundaries.

- Business behavior belongs to objects, not loose procedures.
- Classes represent domain objects, services, components, modules, repositories, transports, adapters, or other explicit runtime roles.
- Composition API is a boundary tool, not a way to bypass object ownership.
- Keep implementation shape obvious from the directory tree and file names.

## OOP Red Lines

- Do not write business workflows as scattered exported functions.
- Do not create procedural files that pass state through a chain of unrelated helpers.
- Do not hide domain behavior in anonymous callbacks when a named method should own it.
- Do not create "manager" or "utils" dumping grounds for unrelated behavior.
- Do not split behavior away from the object that owns its state just to shorten a file.
- Prefer private methods for internal object actions; prefer a new object only when a real boundary appears.

## Composition API Boundary

Composition-style exported functions are allowed only for clear boundary surfaces:

- decorators
- factories
- bootstrap entrypoints
- scripts and local tooling
- protocol adapters
- low-level framework helpers
- explicit framework integration APIs

Composition functions must stay small, intentional, and boundary-shaped. They should not become the primary home of business rules.

## Method Body Discipline

- 300 lines is a soft limit for one method body. If a method goes beyond it, there must be a concrete reason.
- 500 lines is a hard limit. Split before crossing it.
- Under 500 lines, do not extract functions just to make the method look shorter.
- Extract only when the extracted unit has a real name and reason.

Valid extraction reasons:

- the logic is reused
- the extracted method names a domain action
- the method isolates an external side effect
- the method separates a real phase in a complex algorithm
- the split reduces actual cognitive load, not just line count

Invalid extraction reasons:

- "this block is long"
- "helpers look cleaner"
- "one function per tiny step"
- "future reuse"
- "to imitate a pattern from another codebase"

## Directory And File Naming

Use semantic directories plus role files.

- Directory names express the domain/object/module noun.
- File names express the role inside that directory.
- `index.ts` is a barrel only; it must not own behavior.

Preferred role file names:

- `service.ts`
- `types.ts`
- `constants.ts`
- `decorator.ts`
- `factory.ts`
- `container.ts`
- `abstracts.ts`
- `socket.ts`
- `module.ts`
- `entity.ts`
- `repository.ts`
- `*.test.ts`

Avoid adding dotted splits such as `thing.service.ts` when the directory already says `thing`. Legacy names may remain until a focused migration.

## Review Checklist

Before finishing a code change, check:

- Does each behavior live on the object that owns the state or boundary?
- Are exported functions limited to approved boundary APIs?
- Did any helper extraction create a procedural maze?
- Are long methods still coherent and below the hard limit?
- Is any method over 300 lines justified?
- Does every new directory/file name reveal its role?
- Is `index.ts` only re-exporting?
- Are tests focused on the changed behavior rather than incidental structure?
