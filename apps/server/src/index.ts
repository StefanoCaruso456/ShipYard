import cors from "cors";
import express from "express";

import { starterDecisionBoard } from "@shipyard/agent-core";
import { projectBrief } from "@shipyard/shared";

import { registerRuntimeRoutes } from "./routes/runtime";
import { bootRuntimeService } from "./runtime/bootRuntimeService";

const port = Number(process.env.PORT ?? 8787);
const host = process.env.HOST ?? "0.0.0.0";

async function startServer() {
  const { runtimeService, openAI } = await bootRuntimeService();
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/", (_request, response) => {
    const runtimeStatus = runtimeService.getStatus();

    response.json({
      service: "shipyard-server",
      status: "ok",
      message: "Shipyard runtime server is online.",
      endpoints: {
        health: "/api/health",
        project: "/api/project",
        runtimeStatus: "/api/runtime/status",
        runtimeTasks: "/api/runtime/tasks"
      },
      runtime: {
        workerState: runtimeStatus.workerState,
        queuedRuns: runtimeStatus.queuedRuns,
        totalRuns: runtimeStatus.totalRuns
      }
    });
  });

  app.get("/api/health", (_request, response) => {
    const runtimeStatus = runtimeService.getStatus();

    response.json({
      status: "ok",
      service: "shipyard-server",
      instructions: {
        status: "ready",
        skillId: runtimeService.instructionRuntime.skill.meta.id,
        loadedAt: runtimeService.instructionRuntime.loadedAt
      },
      runtime: {
        workerState: runtimeStatus.workerState,
        activeRunId: runtimeStatus.activeRunId,
        queuedRuns: runtimeStatus.queuedRuns,
        totalRuns: runtimeStatus.totalRuns
      },
      model: {
        provider: openAI.provider,
        configured: openAI.configured,
        modelId: openAI.modelId,
        apiKeySource: openAI.apiKeySource
      }
    });
  });

  app.get("/api/project", (_request, response) => {
    response.json({
      ...projectBrief,
      agentDecisions: starterDecisionBoard
    });
  });

  registerRuntimeRoutes(app, runtimeService, openAI);

  app.listen(port, host, () => {
    console.log(`Shipyard server running on http://${host}:${port}`);
  });
}

void startServer().catch((error) => {
  console.error("Failed to boot Shipyard runtime.", error);
  process.exit(1);
});
