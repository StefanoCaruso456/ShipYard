import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { applyRuntimeWorkspacePlan } from "../runtime/runtimeWorkspacePlan";

test("applyRuntimeWorkspacePlan adds TS6 ignoreDeprecations when generated tsconfig uses baseUrl", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "shipyard-runtime-plan-"));

  try {
    await applyRuntimeWorkspacePlan({
      rootDir,
      plan: {
        operations: [
          {
            kind: "write_file",
            path: "tsconfig.json",
            content: JSON.stringify(
              {
                compilerOptions: {
                  target: "ES2017",
                  baseUrl: "."
                }
              },
              null,
              2
            )
          }
        ]
      }
    });

    const written = await readFile(path.join(rootDir, "tsconfig.json"), "utf8");
    const parsed = JSON.parse(written) as {
      compilerOptions?: {
        baseUrl?: string;
        ignoreDeprecations?: string;
      };
    };

    assert.equal(parsed.compilerOptions?.baseUrl, ".");
    assert.equal(parsed.compilerOptions?.ignoreDeprecations, "6.0");
  } finally {
    await rm(rootDir, { recursive: true, force: true });
  }
});
