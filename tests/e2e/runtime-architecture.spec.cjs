const { expect, test } = require("@playwright/test");
const { readFile } = require("node:fs/promises");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "..", "..");
const traceLogPath = path.join(repoRoot, ".shipyard", "runtime", "traces.jsonl");
const runtimeApiBaseUrl = "http://127.0.0.1:8787";

test("runtime architecture smoke flow completes and leaves trace evidence", async ({
  page,
  request
}) => {
  const instruction = `E2E architecture validation ${Date.now()}`;

  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /Let's build Shipyard Runtime/i })
  ).toBeVisible();
  await expect(page.getByPlaceholder("Ask Codex anything...")).toBeVisible();

  await page.getByPlaceholder("Ask Codex anything...").fill(instruction);
  await page.getByRole("button", { name: "Send message" }).click();

  let run = null;

  await expect
    .poll(
      async () => {
        const response = await request.get(`${runtimeApiBaseUrl}/api/runtime/tasks`);
        expect(response.ok()).toBeTruthy();
        const payload = await response.json();

        run =
          payload.tasks.find((candidate) => candidate.instruction === instruction) ?? null;

        return Boolean(run);
      },
      {
        timeout: 60_000,
        message: "Expected the submitted runtime task to appear."
      }
    )
    .toBeTruthy();

  const runId = run.id;

  await expect
    .poll(
      async () => {
        const response = await request.get(`${runtimeApiBaseUrl}/api/runtime/tasks/${runId}`);
        expect(response.ok()).toBeTruthy();
        const payload = await response.json();

        return payload.task.status;
      },
      {
        timeout: 60_000,
        message: "Expected the runtime task to complete."
      }
    )
    .toBe("completed");

  await expect(page.getByText("Execution trace")).toBeVisible();
  await expect(page.getByText("Run completed")).toBeVisible();
  await expect(page.locator(".message__paragraph").filter({ hasText: instruction })).toBeVisible();

  const traceResponse = await request.get(`${runtimeApiBaseUrl}/api/runtime/traces/${runId}`);
  expect(traceResponse.ok()).toBeTruthy();

  const tracePayload = await traceResponse.json();

  expect(tracePayload.trace.summary.status).toBe("completed");
  expect(tracePayload.trace.summary.roleFlow).toBe("orchestration");
  expect(tracePayload.trace.spans.some((span) => span.spanType === "run")).toBeTruthy();
  expect(tracePayload.trace.spans.some((span) => span.spanType === "context")).toBeTruthy();
  expect(tracePayload.trace.spans.some((span) => span.name === "planner")).toBeTruthy();
  expect(tracePayload.trace.spans.some((span) => span.name === "executor")).toBeTruthy();
  expect(tracePayload.trace.spans.some((span) => span.name === "verifier")).toBeTruthy();

  await expect
    .poll(
      async () => {
        const log = await readFile(traceLogPath, "utf8");
        return log.includes(runId);
      },
      {
        timeout: 20_000,
        message: "Expected the trace log to contain the completed run id."
      }
    )
    .toBeTruthy();
});
