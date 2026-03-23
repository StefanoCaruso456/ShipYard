# Contributing

These rules define how the coding agent must behave inside this repository. The goal is to preserve architecture quality, reduce risky edits, and keep changes consistent with project standards.

## Session Branch Rule

For Codex work on this repo:

- Use one branch per working session.
- Do not push directly to `main`.
- When the session is done, commit the changes on the session branch.
- Push the session branch to GitHub.
- Open a pull request into `main`.
- The user reviews and merges the PR into `main`.

## Branch Naming

Use the `codex/` prefix for Codex session branches.

Example:

```text
codex/session-agent-loop
```

## General Editing Rules

- Do not make speculative edits.
- Do not edit a file until you have searched for and read the relevant surrounding context.
- Prefer minimal changes over broad rewrites.
- Preserve existing architecture unless the task explicitly requires architectural change.
- Do not change unrelated code while fixing the requested issue.
- Do not delete code unless the task clearly requires removal.
- Do not introduce new dependencies unless necessary and justified.
- Do not edit generated files unless explicitly instructed.
- Do not edit secrets, credentials, environment values, or deployment configuration unless explicitly required.

## File Editing Policy

- Always follow: search -> read -> patch -> verify.
- Use targeted edits first.
- Only rewrite a full file if:
  1. the file is small enough to safely rewrite,
  2. targeted patching fails twice,
  3. the rewrite is lower risk than repeated patch attempts.
- After every edit, re-read the changed section to confirm the result landed correctly.
- If the target location appears wrong, stop editing and re-localize before trying again.

## Architecture Rules

- Respect the existing folder structure and ownership boundaries.
- Keep business logic out of presentation/UI components unless the project already intentionally uses that pattern.
- Reuse existing utilities, components, hooks, services, and helpers before creating new ones.
- Prefer extending current patterns over introducing parallel patterns.
- New files must be placed in the most logical existing directory.
- If a new abstraction is introduced, it must reduce duplication or improve clarity in a meaningful way.

## Naming and Consistency

- Follow the repo’s existing naming conventions exactly.
- Match surrounding style for:
  - file names
  - function names
  - type names
  - test naming
  - imports
  - formatting patterns
- Do not rename files, symbols, or exports unless required by the task.

## Validation Rules

- Validate every meaningful code change.
- Start with the narrowest useful validation:
  - targeted test
  - typecheck on impacted area
  - lint on changed file(s)
- Expand validation only when needed.
- If validation fails after an edit:
  1. inspect the failure,
  2. determine whether the edit caused it,
  3. rollback or revise before continuing.
- Do not claim success without validation evidence.

## Safety and Recovery

- Treat failed edits as runtime events, not as reasons to guess harder.
- If patching fails once, re-check the file contents.
- If patching fails twice, switch strategy or stop and explain why.
- If validation regresses after an edit, rollback or repair before making further changes.
- Never stack multiple speculative fixes on top of a broken state.

## Scope Control

- Stay inside the requested scope.
- If you notice adjacent issues, mention them separately instead of silently fixing everything.
- Avoid refactors unless:
  - they are required for the task,
  - they reduce clear technical debt directly blocking the task,
  - they remain small and verifiable.

## Output Expectations

For each completed task, provide:

- what changed
- which files were touched
- how the change works
- what validation was run
- any remaining risks or follow-ups

## Forbidden Behaviors

- Do not invent files, functions, or architecture without checking the repo.
- Do not claim a command passed if it did not run.
- Do not assume a patch applied correctly without re-reading the result.
- Do not ignore failing validation.
- Do not rewrite large files when a precise patch is sufficient.
- Do not bypass existing project patterns without justification.

## Preferred Operating Principle

The agent should behave like a careful senior engineer:

- understand first,
- edit second,
- verify third,
- summarize clearly.
