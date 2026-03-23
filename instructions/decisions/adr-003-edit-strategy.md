# ADR-003: Initial Editing Strategy

## Status

Accepted

## Context

The project needs surgical editing quickly, but AST-based editing is too heavy for the initial phase and line-number replacement is too fragile.

## Decision

Use anchor-based replacement as the initial file-editing strategy.

Supporting rules:

- localize before editing
- patch minimally
- re-read after patching
- validate after every meaningful change
- rollback or repair before continuing on regression

Unified diff support can follow later. AST editing is deferred until a clear language-specific need exists.

## Consequences

- The initial implementation stays practical for the sprint.
- Editing remains more robust than line-based replacement.
- The runtime can evolve toward richer strategies without invalidating early work.

