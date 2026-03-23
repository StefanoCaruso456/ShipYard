import cors from "cors";
import express from "express";

import { starterDecisionBoard, type AgentInstructionRuntime } from "@shipyard/agent-core";
import { projectBrief } from "@shipyard/shared";

import { bootAgentRuntime } from "./runtime/bootAgentRuntime";

const port = Number(process.env.PORT ?? 8787);

async function startServer() {
  const agentRuntime = await bootAgentRuntime();
  const app = express();

  app.use(cors());
  app.use(express.json());

  app.get("/api/health", (_request, response) => {
    response.json({
      status: "ok",
      service: "shipyard-server",
      instructions: {
        status: "ready",
        skillId: agentRuntime.skill.meta.id,
        loadedAt: agentRuntime.loadedAt
      }
    });
  });

  app.get("/api/project", (_request, response) => {
    response.json({
      ...projectBrief,
      agentDecisions: starterDecisionBoard
    });
  });

  app.get("/api/runtime/instructions/skill", (_request, response) => {
    response.json(serializeSkillRuntime(agentRuntime));
  });

  app.listen(port, () => {
    console.log(`Shipyard server running on http://localhost:${port}`);
  });
}

void startServer().catch((error) => {
  console.error("Failed to boot Shipyard runtime.", error);
  process.exit(1);
});

function serializeSkillRuntime(agentRuntime: AgentInstructionRuntime) {
  return {
    loadedAt: agentRuntime.loadedAt,
    instructionPrecedence: agentRuntime.instructionPrecedence,
    skill: {
      sourcePath: agentRuntime.skill.sourcePath,
      meta: agentRuntime.skill.meta,
      sectionCount: agentRuntime.skill.sections.length,
      sections: agentRuntime.skill.sections.map((section) => ({
        id: section.id,
        title: section.title,
        depth: section.depth,
        path: section.path
      }))
    },
    roleViews: Object.fromEntries(
      Object.entries(agentRuntime.roleViews).map(([role, view]) => [
        role,
        {
          sectionIds: view.sectionIds,
          sections: view.sections.map((section) => ({
            id: section.id,
            title: section.title,
            path: section.path
          })),
          renderedText: view.renderedText
        }
      ])
    )
  };
}
