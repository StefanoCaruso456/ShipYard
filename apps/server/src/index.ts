import cors from "cors";
import express from "express";
import { createServer, type Server } from "node:http";

import {
  starterDecisionBoard,
  type ContextAssembler,
  type PersistentAgentRuntimeService,
  type TraceService
} from "@shipyard/agent-core";
import { projectBrief } from "@shipyard/shared";

import { registerRuntimeRoutes } from "./routes/runtime";
import {
  bootRuntimeService,
  type RuntimeStoreDescriptor
} from "./runtime/bootRuntimeService";
import type { AudioTranscriptionConfig } from "./runtime/createAudioTranscriber";
import type { OpenAIExecutorConfig } from "./runtime/createOpenAIExecutor";

type RuntimeBootState = {
  status: "booting" | "ready" | "failed";
  startedAt: string;
  completedAt: string | null;
  runtimeService: PersistentAgentRuntimeService | null;
  contextAssembler: ContextAssembler | null;
  openAI: OpenAIExecutorConfig | null;
  audioTranscription: AudioTranscriptionConfig | null;
  traceService: TraceService | null;
  runtimeStore: RuntimeStoreDescriptor | null;
};

const host = process.env.HOST?.trim() || "0.0.0.0";
const primaryPort = resolvePort(process.env.PORT);
const secondaryPort = resolveOptionalPort(process.env.SHIPYARD_SERVER_PORT);

async function startServer() {
  const bootState: RuntimeBootState = {
    status: "booting",
    startedAt: new Date().toISOString(),
    completedAt: null,
    runtimeService: null,
    contextAssembler: null,
    openAI: null,
    audioTranscription: null,
    traceService: null,
    runtimeStore: null
  };
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/", (_request, response) => {
    response.json(createRootPayload(bootState));
  });

  app.get("/api/health", (_request, response) => {
    const payload = createHealthPayload(bootState);
    response.status(bootState.status === "ready" ? 200 : 503).json(payload);
  });

  app.get("/api/project", (_request, response) => {
    response.json({
      ...projectBrief,
      agentDecisions: starterDecisionBoard
    });
  });

  app.use("/api/runtime", (_request, response, next) => {
    if (!isRuntimeReady(bootState)) {
      response.status(503).json({
        status: bootState.status,
        service: "shipyard-server",
        message:
          bootState.status === "failed"
            ? "Runtime boot failed. Check server logs for details."
            : "Runtime routes are not ready yet.",
        boot: createBootSummary(bootState)
      });
      return;
    }

    next();
  });

  const servers = [
    createBoundServer(app, {
      port: primaryPort,
      portSource: process.env.PORT ? "PORT" : "default"
    })
  ];

  if (secondaryPort !== null && secondaryPort !== primaryPort) {
    servers.push(
      createBoundServer(app, {
        port: secondaryPort,
        portSource: "SHIPYARD_SERVER_PORT"
      })
    );
  }

  registerShutdownHandlers(servers);

  void bootRuntime(app, bootState);
}

async function bootRuntime(app: ReturnType<typeof express>, bootState: RuntimeBootState) {
  console.log("Booting Shipyard runtime.", {
    startedAt: bootState.startedAt
  });

  try {
    const {
      runtimeService,
      contextAssembler,
      openAI,
      audioTranscriber,
      runtimeStatePath,
      runtimeStore,
      traceService,
      traceLogPath
    } =
      await bootRuntimeService();

    bootState.status = "ready";
    bootState.completedAt = new Date().toISOString();
    bootState.runtimeService = runtimeService;
    bootState.contextAssembler = contextAssembler;
    bootState.openAI = openAI;
    bootState.audioTranscription = audioTranscriber.config;
    bootState.traceService = traceService;
    bootState.runtimeStore = runtimeStore;

    registerRuntimeRoutes(
      app,
      runtimeService,
      openAI,
      audioTranscriber,
      contextAssembler,
      traceService
    );

    console.log("Shipyard runtime boot complete.", {
      completedAt: bootState.completedAt,
      runtimeStatePath,
      runtimeStore,
      traceLogPath,
      skillId: runtimeService.instructionRuntime.skill.meta.id,
      openAIConfigured: openAI.configured,
      modelId: openAI.modelId
    });
  } catch (error) {
    bootState.status = "failed";
    bootState.completedAt = new Date().toISOString();

    console.error("Failed to boot Shipyard runtime.", {
      completedAt: bootState.completedAt,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    });
  }
}

function createRootPayload(bootState: RuntimeBootState) {
  const basePayload = {
    service: "shipyard-server",
    status: bootState.status === "ready" ? "ok" : bootState.status,
    message:
      bootState.status === "ready"
        ? "Shipyard runtime server is online."
        : bootState.status === "failed"
          ? "Shipyard runtime server failed during boot. Check server logs for details."
          : "Shipyard runtime server is starting up.",
    endpoints: {
      health: "/api/health",
      project: "/api/project",
      runtimeStatus: "/api/runtime/status",
      runtimeTasks: "/api/runtime/tasks"
    },
    boot: createBootSummary(bootState)
  };

  if (!isRuntimeReady(bootState)) {
    return basePayload;
  }

  const runtimeStatus = bootState.runtimeService.getStatus();

  return {
    ...basePayload,
    runtime: {
      workerState: runtimeStatus.workerState,
      queuedRuns: runtimeStatus.queuedRuns,
      totalRuns: runtimeStatus.totalRuns
    },
    runtimeStorage: bootState.runtimeStore
  };
}

function createHealthPayload(bootState: RuntimeBootState) {
  if (!isRuntimeReady(bootState)) {
    return {
      status: bootState.status,
      service: "shipyard-server",
      message:
        bootState.status === "failed"
          ? "Runtime boot failed. Check server logs for details."
          : "Runtime boot is still in progress.",
      boot: createBootSummary(bootState)
    };
  }

  const runtimeStatus = bootState.runtimeService.getStatus();

  return {
    status: "ok",
    service: "shipyard-server",
    boot: createBootSummary(bootState),
    instructions: {
      status: "ready",
      skillId: bootState.runtimeService.instructionRuntime.skill.meta.id,
      loadedAt: bootState.runtimeService.instructionRuntime.loadedAt
    },
    runtime: {
      workerState: runtimeStatus.workerState,
      activeRunId: runtimeStatus.activeRunId,
      queuedRuns: runtimeStatus.queuedRuns,
      totalRuns: runtimeStatus.totalRuns
    },
    runtimeStorage: bootState.runtimeStore,
    model: {
      provider: bootState.openAI.provider,
      configured: bootState.openAI.configured,
      modelId: bootState.openAI.modelId,
      apiKeySource: bootState.openAI.apiKeySource
    },
    observability: bootState.traceService?.status ?? null,
    audioTranscription: {
      provider: bootState.audioTranscription.provider,
      configured: bootState.audioTranscription.configured,
      modelId: bootState.audioTranscription.modelId,
      apiKeySource: bootState.audioTranscription.apiKeySource
    }
  };
}

function createBootSummary(bootState: RuntimeBootState) {
  return {
    status: bootState.status,
    startedAt: bootState.startedAt,
    completedAt: bootState.completedAt
  };
}

function isRuntimeReady(
  bootState: RuntimeBootState
): bootState is RuntimeBootState & {
  status: "ready";
  runtimeService: PersistentAgentRuntimeService;
  contextAssembler: ContextAssembler;
  openAI: OpenAIExecutorConfig;
  audioTranscription: AudioTranscriptionConfig;
  traceService: TraceService;
} {
  return (
    bootState.status === "ready" &&
    bootState.runtimeService !== null &&
    bootState.contextAssembler !== null &&
    bootState.openAI !== null &&
    bootState.audioTranscription !== null &&
    bootState.traceService !== null
  );
}

function createBoundServer(
  app: ReturnType<typeof express>,
  options: {
    port: number;
    portSource: "PORT" | "SHIPYARD_SERVER_PORT" | "default";
  }
) {
  const server = createServer(app);

  server.on("error", (error) => {
    console.error("Shipyard server failed to bind.", {
      host,
      port: options.port,
      portSource: options.portSource,
      error: error instanceof Error ? error.message : String(error)
    });

    process.exit(1);
  });

  server.listen(options.port, host, () => {
    console.log("Shipyard server listening.", {
      host,
      port: options.port,
      portSource: options.portSource,
      nodeEnv: process.env.NODE_ENV ?? "development",
      cwd: process.cwd()
    });
  });

  return server;
}

function registerShutdownHandlers(servers: Server[]) {
  let shuttingDown = false;

  const shutdown = (signal: "SIGINT" | "SIGTERM") => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;

    console.log("Shutting down Shipyard server.", {
      signal
    });

    let closedCount = 0;
    let failed = false;

    for (const server of servers) {
      server.close((error) => {
        if (failed) {
          return;
        }

        if (error) {
          failed = true;
          console.error("Shipyard server shutdown failed.", {
            error: error instanceof Error ? error.message : String(error)
          });
          process.exit(1);
        }

        closedCount += 1;

        if (closedCount === servers.length) {
          process.exit(0);
        }
      });
    }

    setTimeout(() => {
      console.error("Shipyard server shutdown timed out.");
      process.exit(1);
    }, 10_000).unref();
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

function resolvePort(portValue: string | undefined) {
  const parsed = Number(portValue ?? 8787);

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn("Invalid PORT value detected. Falling back to 8787.", {
    configuredPortValue: portValue
  });

  return 8787;
}

function resolveOptionalPort(portValue: string | undefined) {
  if (!portValue?.trim()) {
    return null;
  }

  const parsed = Number(portValue);

  if (Number.isInteger(parsed) && parsed > 0) {
    return parsed;
  }

  console.warn("Invalid SHIPYARD_SERVER_PORT value detected. Ignoring override.", {
    configuredPortValue: portValue
  });

  return null;
}

void startServer().catch((error) => {
  console.error("Shipyard server failed before listen.", {
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined
  });
  process.exit(1);
});
