# Task Prompt Template

## Purpose

This file defines the assignment format you give the builder agent each time it works on a feature, bug, or refactor while building the harness.

It does not replace permanent repo rules or workflow logic. It gives the agent a clean, scoped mission for a single task.

## Template

```md
# Task Prompt

## Objective
[Describe the exact thing the agent needs to build, fix, or improve.]

## User Outcome
[Describe the user-facing or business-facing result.]

## Scope
[State what is in scope and out of scope.]

## Constraints
- Follow project rules.
- Follow skill.md operating procedure.
- Reuse existing patterns before creating new ones.
- Keep the change minimal and scoped.
- Do not change unrelated behavior.

## Likely Impacted Areas
[List files, folders, components, services, routes, tests, schemas, or leave blank if unknown.]

## Acceptance Criteria
- [Criterion 1]
- [Criterion 2]
- [Criterion 3]

## Validation Requirements
- [Test or command 1]
- [Test or command 2]
- [Typecheck/lint/build if needed]

## Edge Cases
- [Edge case 1]
- [Edge case 2]

## Output Format
Return:
1. summary of what changed
2. files touched
3. validation run
4. result
5. any remaining risks
```

## Example

```md
# Task Prompt

## Objective
Add a notification preferences settings page that allows a signed-in user to toggle email notifications for product updates, billing reminders, and referral activity.

## User Outcome
Users can manage their notification preferences from the settings area without contacting support.

## Scope
In scope:
- settings page UI
- backend update handler
- persistence for preferences
- validation
- tests for the new behavior

Out of scope:
- push notifications
- SMS notifications
- redesign of the overall settings layout

## Constraints
- Follow project rules.
- Follow skill.md operating procedure.
- Reuse existing settings components and form patterns.
- Keep the change minimal and scoped.
- Do not introduce a new state management pattern.

## Likely Impacted Areas
- settings page
- user preferences model
- backend user settings route
- form validation
- relevant tests

## Acceptance Criteria
- Users can view current notification settings.
- Users can update and save preferences successfully.
- Validation prevents invalid preference payloads.
- Existing settings functionality remains unchanged.

## Validation Requirements
- run relevant settings tests
- run impacted backend tests
- run lint on changed files
- run typecheck on impacted area

## Edge Cases
- user has no saved preferences yet
- backend returns validation error
- partial payload should not corrupt existing preferences

## Output Format
Return:
1. summary of what changed
2. files touched
3. validation run
4. result
5. any remaining risks
```

## Why It Matters

Even a strong agent needs a clean mission.

Purpose:

- give the agent the exact assignment for one task
- avoid repeating permanent repo rules inside every prompt
- keep the work scoped and testable

Outcome:

- cleaner execution
- better task accuracy
- more consistent results across features, fixes, and refactors

## System Placement

This file belongs to System A: the builder agent.

System A:

- the builder agent
- uses project rules
- uses this task prompt template for implementation work
- builds the harness

System B:

- the product AI harness
- uses `skill.md`
- runs the agent loop
- executes tools
- handles context injection
