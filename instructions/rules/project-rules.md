# Project Rules

## Purpose

Define how work should be done in this repository.

These rules keep changes:

- scoped
- safe
- verifiable
- consistent with the existing architecture

## Core Workflow

Always follow:

1. search
2. read
3. patch
4. verify

## Editing Rules

- Do not make speculative edits.
- Prefer minimal changes over broad rewrites.
- Do not change unrelated behavior.
- Re-read the changed section after every edit.
- Do not rewrite full files unless targeted editing is clearly riskier.

## Architecture Rules

- Respect the current folder structure and ownership boundaries.
- Reuse existing patterns before introducing new ones.
- Keep business logic out of UI layers unless the project already does otherwise.
- Add new abstractions only when they clearly improve clarity or reduce duplication.

## Validation Rules

- Validate every meaningful change.
- Start with the narrowest useful validation.
- If validation fails, inspect it before making more edits.
- Do not claim success without validation evidence.

## Safety Rules

- If localization is wrong, stop and re-localize.
- If patching fails twice, change strategy or escalate.
- If validation regresses, rollback or repair before continuing.
- Never stack speculative fixes on top of a broken state.

## Scope Rules

- Stay inside the requested scope.
- Mention adjacent issues separately instead of silently fixing them.
- Avoid refactors unless they are required to complete the task safely.

## Output Rules

For each completed task, report:

- what changed
- files touched
- how it works
- validation run
- remaining risks or follow-ups
