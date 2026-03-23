import cors from "cors";
import express from "express";

import { starterDecisionBoard } from "@shipyard/agent-core";
import { projectBrief } from "@shipyard/shared";

const app = express();
const port = Number(process.env.PORT ?? 8787);

app.use(cors());
app.use(express.json());

app.get("/api/health", (_request, response) => {
  response.json({
    status: "ok",
    service: "shipyard-server"
  });
});

app.get("/api/project", (_request, response) => {
  response.json({
    ...projectBrief,
    agentDecisions: starterDecisionBoard
  });
});

app.listen(port, () => {
  console.log(`Shipyard server running on http://localhost:${port}`);
});

