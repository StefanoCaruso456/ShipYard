# Editing Strategy

## Decision

Start with anchor-based surgical editing.

## Why

- It is simpler than AST-based editing.
- It is less fragile than raw line-number replacement.
- It fits the sprint better than a language-specific AST system.

## Phase Sequence

### Phase 1

- anchor-based replacement
- strict localization before edit
- validation after every meaningful edit
- recovery when anchors do not match

### Phase 2

- add unified diff-style patch support where useful

### Later

- add AST editing only for languages where the complexity is justified

## Required Guardrails

- search before edit
- read local context before patching
- patch the smallest viable section
- re-read changed code after every edit
- validate after every meaningful change
- rollback or repair before continuing when validation regresses

## Failure Policy

If an edit target is wrong:

1. stop
2. re-localize
3. try a different signal
4. retry once
5. escalate instead of guessing

## Constraint

Do not start by rewriting full files as a default strategy. Whole-file rewrites are only acceptable when they are clearly lower risk than precise edits.

