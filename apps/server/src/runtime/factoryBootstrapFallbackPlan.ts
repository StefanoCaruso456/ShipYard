import type { AgentRunRecord } from "@shipyard/agent-core";

import type { RuntimeWorkspacePlan, RuntimeWorkspacePlanOperation } from "./runtimeWorkspacePlan";

type BootstrapTask = {
  id?: string | null;
};

export function buildFactoryBootstrapFallbackPlan(input: {
  run: AgentRunRecord;
  task: BootstrapTask | null;
}): RuntimeWorkspacePlan | null {
  if (!isRepositoryBootstrapTask(input.run, input.task)) {
    return null;
  }

  const factory = input.run.factory;

  if (!factory) {
    return null;
  }

  switch (factory.stack.templateId) {
    case "nextjs_supabase_vercel":
      return buildNextJsBootstrapPlan({
        appName: factory.appName,
        productBrief: factory.productBrief,
        repositoryName: factory.repository.name,
        dataProviderLabel: "Supabase",
        envExample: [
          "NEXT_PUBLIC_SUPABASE_URL=",
          "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
          "SUPABASE_SERVICE_ROLE_KEY="
        ].join("\n")
      });
    case "nextjs_railway_postgres":
      return buildNextJsBootstrapPlan({
        appName: factory.appName,
        productBrief: factory.productBrief,
        repositoryName: factory.repository.name,
        dataProviderLabel: "Railway Postgres",
        envExample: [
          "DATABASE_URL=",
          "SESSION_SECRET=",
          "NEXT_PUBLIC_APP_URL=http://localhost:3000"
        ].join("\n")
      });
    case "react_express_railway":
      return buildReactExpressBootstrapPlan({
        appName: factory.appName,
        productBrief: factory.productBrief,
        repositoryName: factory.repository.name
      });
    default:
      return null;
  }
}

export function renderBootstrapRecoveryPlanGuidance(run: AgentRunRecord) {
  if (
    run.phaseExecution?.current.phaseId !== "factory-bootstrap" ||
    run.phaseExecution?.current.taskId !== "task-repository-bootstrap" ||
    !run.factory
  ) {
    return null;
  }

  switch (run.factory.stack.templateId) {
    case "nextjs_supabase_vercel":
    case "nextjs_railway_postgres":
      return [
        "Bootstrap scaffold guidance:",
        `- This is the repository-foundation task for ${run.factory.appName} on ${run.factory.stack.label}.`,
        "- If the visible response is prose-only, recover by emitting a starter Next.js App Router scaffold plan.",
        "- At minimum include package.json, tsconfig.json, next-env.d.ts, next.config.ts, app/layout.tsx, app/page.tsx, app/globals.css, .env.example, and README.md.",
        "- Reuse and update the seeded README.md and keep the scaffold local to the connected runtime workspace."
      ].join("\n");
    case "react_express_railway":
      return [
        "Bootstrap scaffold guidance:",
        `- This is the repository-foundation task for ${run.factory.appName} on ${run.factory.stack.label}.`,
        "- If the visible response is prose-only, recover by emitting a starter React plus Express scaffold plan.",
        "- At minimum include root package.json, client package and entry files, server package and entry files, shared TypeScript config, .env.example, and README.md.",
        "- Reuse and update the seeded README.md and keep the scaffold local to the connected runtime workspace."
      ].join("\n");
    default:
      return null;
  }
}

function isRepositoryBootstrapTask(
  run: AgentRunRecord,
  task: BootstrapTask | null
) {
  return (
    run.phaseExecution?.current.phaseId === "factory-bootstrap" &&
    (task?.id === "task-repository-bootstrap" ||
      run.phaseExecution?.current.taskId === "task-repository-bootstrap") &&
    run.factory?.currentStage === "bootstrap"
  );
}

function buildNextJsBootstrapPlan(input: {
  appName: string;
  productBrief: string;
  repositoryName: string;
  dataProviderLabel: string;
  envExample: string;
}): RuntimeWorkspacePlan {
  return {
    operations: [
      writeFile(
        "package.json",
        toJsonFile({
          name: input.repositoryName,
          private: true,
          version: "0.1.0",
          scripts: {
            dev: "next dev",
            build: "next build",
            start: "next start",
            typecheck: "tsc --noEmit"
          },
          dependencies: {
            next: "^15.0.0",
            react: "^19.0.0",
            "react-dom": "^19.0.0"
          },
          devDependencies: {
            "@types/node": "^22.0.0",
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            typescript: "^5.6.0"
          }
        })
      ),
      writeFile(
        "tsconfig.json",
        toJsonFile({
          compilerOptions: {
            target: "ES2022",
            lib: ["dom", "dom.iterable", "es2022"],
            allowJs: false,
            skipLibCheck: true,
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            module: "esnext",
            moduleResolution: "bundler",
            resolveJsonModule: true,
            isolatedModules: true,
            jsx: "preserve",
            incremental: true,
            plugins: [{ name: "next" }]
          },
          include: ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
          exclude: ["node_modules"]
        })
      ),
      writeFile(
        "next-env.d.ts",
        [
          "/// <reference types=\"next\" />",
          "/// <reference types=\"next/image-types/global\" />",
          "",
          "// This file is auto-generated by Next.js."
        ].join("\n")
      ),
      writeFile(
        "next.config.ts",
        [
          "import type { NextConfig } from \"next\";",
          "",
          "const nextConfig: NextConfig = {",
          "  reactStrictMode: true",
          "};",
          "",
          "export default nextConfig;"
        ].join("\n")
      ),
      writeFile(
        "app/layout.tsx",
        [
          "import type { Metadata } from \"next\";",
          "import \"./globals.css\";",
          "",
          "export const metadata: Metadata = {",
          `  title: \"${escapeForDoubleQuotedString(input.appName)}\",`,
          `  description: \"${escapeForDoubleQuotedString(input.productBrief)}\"`,
          "};",
          "",
          "export default function RootLayout({",
          "  children",
          "}: Readonly<{",
          "  children: React.ReactNode;",
          "}>) {",
          "  return (",
          "    <html lang=\"en\">",
          "      <body>{children}</body>",
          "    </html>",
          "  );",
          "}"
        ].join("\n")
      ),
      writeFile(
        "app/page.tsx",
        [
          "const highlights = [",
          `  \"Stacked for ${input.dataProviderLabel}\",`,
          "  \"Seeded for local-first Factory delivery\",",
          "  \"Ready for the first implementation slice\"",
          "];",
          "",
          "export default function HomePage() {",
          "  return (",
          "    <main className=\"page\">",
          "      <section className=\"hero\">",
          `        <p className=\"eyebrow\">${escapeForJsTemplateLiteral(input.appName)}</p>`,
          `        <h1>Bootstrap scaffold for ${escapeForJsTemplateLiteral(input.appName)}</h1>`,
          `        <p className=\"summary\">${escapeForJsTemplateLiteral(input.productBrief)}</p>`,
          "      </section>",
          "      <section className=\"panel\">",
          "        <h2>Repository foundation</h2>",
          "        <ul>",
          "          {highlights.map((item) => (",
          "            <li key={item}>{item}</li>",
          "          ))}",
          "        </ul>",
          "      </section>",
          "    </main>",
          "  );",
          "}"
        ].join("\n")
      ),
      writeFile(
        "app/globals.css",
        [
          ":root {",
          "  color-scheme: dark;",
          "  --bg: #07111f;",
          "  --bg-accent: #10223d;",
          "  --card: rgba(9, 18, 34, 0.82);",
          "  --text: #f5f7fb;",
          "  --muted: #9eb1d1;",
          "  --line: rgba(158, 177, 209, 0.2);",
          "  --accent: #7dd3fc;",
          "}",
          "",
          "* {",
          "  box-sizing: border-box;",
          "}",
          "",
          "body {",
          "  margin: 0;",
          "  min-height: 100vh;",
          "  font-family: \"SF Pro Display\", \"Segoe UI\", sans-serif;",
          "  background: radial-gradient(circle at top, #14355d 0%, var(--bg) 55%);",
          "  color: var(--text);",
          "}",
          "",
          ".page {",
          "  min-height: 100vh;",
          "  display: grid;",
          "  gap: 1.5rem;",
          "  padding: 4rem 1.5rem;",
          "  width: min(64rem, 100%);",
          "  margin: 0 auto;",
          "}",
          "",
          ".hero,",
          ".panel {",
          "  border: 1px solid var(--line);",
          "  border-radius: 1.5rem;",
          "  background: var(--card);",
          "  padding: 1.5rem;",
          "  backdrop-filter: blur(12px);",
          "}",
          "",
          ".eyebrow {",
          "  text-transform: uppercase;",
          "  letter-spacing: 0.16em;",
          "  font-size: 0.75rem;",
          "  color: var(--accent);",
          "}",
          "",
          "h1,",
          "h2 {",
          "  margin: 0 0 1rem;",
          "}",
          "",
          ".summary {",
          "  margin: 0;",
          "  color: var(--muted);",
          "  max-width: 42rem;",
          "}",
          "",
          "ul {",
          "  margin: 0;",
          "  padding-left: 1.25rem;",
          "  color: var(--muted);",
          "}"
        ].join("\n")
      ),
      writeFile(".env.example", `${input.envExample}\n`),
      writeFile("README.md", buildNextJsReadme(input))
    ]
  };
}

function buildReactExpressBootstrapPlan(input: {
  appName: string;
  productBrief: string;
  repositoryName: string;
}): RuntimeWorkspacePlan {
  return {
    operations: [
      writeFile(
        "package.json",
        toJsonFile({
          name: input.repositoryName,
          private: true,
          version: "0.1.0",
          workspaces: ["client", "server"],
          scripts: {
            dev: "npm run dev:client",
            "dev:client": "npm run dev --workspace client",
            "dev:server": "npm run dev --workspace server",
            build: "npm run build --workspace client && npm run build --workspace server",
            typecheck: "npm run typecheck --workspace client && npm run typecheck --workspace server"
          }
        })
      ),
      writeFile(
        "tsconfig.base.json",
        toJsonFile({
          compilerOptions: {
            target: "ES2022",
            module: "ESNext",
            moduleResolution: "bundler",
            strict: true,
            noEmit: true,
            esModuleInterop: true,
            skipLibCheck: true,
            resolveJsonModule: true
          }
        })
      ),
      writeFile(
        "client/package.json",
        toJsonFile({
          name: `${input.repositoryName}-client`,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "vite",
            build: "vite build",
            preview: "vite preview",
            typecheck: "tsc --noEmit"
          },
          dependencies: {
            react: "^19.0.0",
            "react-dom": "^19.0.0"
          },
          devDependencies: {
            "@types/react": "^19.0.0",
            "@types/react-dom": "^19.0.0",
            "@vitejs/plugin-react": "^4.3.0",
            typescript: "^5.6.0",
            vite: "^5.4.0"
          }
        })
      ),
      writeFile(
        "client/tsconfig.json",
        toJsonFile({
          extends: "../tsconfig.base.json",
          compilerOptions: {
            jsx: "react-jsx",
            types: ["vite/client"]
          },
          include: ["src", "vite.config.ts"]
        })
      ),
      writeFile(
        "client/vite.config.ts",
        [
          "import { defineConfig } from \"vite\";",
          "import react from \"@vitejs/plugin-react\";",
          "",
          "export default defineConfig({",
          "  plugins: [react()]",
          "});"
        ].join("\n")
      ),
      writeFile(
        "client/index.html",
        [
          "<!doctype html>",
          "<html lang=\"en\">",
          "  <head>",
          "    <meta charset=\"UTF-8\" />",
          "    <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\" />",
          `    <title>${escapeForHtml(input.appName)}</title>`,
          "  </head>",
          "  <body>",
          "    <div id=\"root\"></div>",
          "    <script type=\"module\" src=\"/src/main.tsx\"></script>",
          "  </body>",
          "</html>"
        ].join("\n")
      ),
      writeFile(
        "client/src/main.tsx",
        [
          "import React from \"react\";",
          "import ReactDOM from \"react-dom/client\";",
          "",
          "import App from \"./App\";",
          "import \"./styles.css\";",
          "",
          "ReactDOM.createRoot(document.getElementById(\"root\")!).render(",
          "  <React.StrictMode>",
          "    <App />",
          "  </React.StrictMode>",
          ");"
        ].join("\n")
      ),
      writeFile(
        "client/src/App.tsx",
        [
          "const checkpoints = [",
          "  \"Bootstrap workspace created\",",
          "  \"Frontend shell ready for implementation\",",
          "  \"API surface ready for connection\"",
          "];",
          "",
          "export default function App() {",
          "  return (",
          "    <main className=\"page\">",
          "      <section className=\"hero\">",
          `        <p className=\"eyebrow\">${escapeForJsTemplateLiteral(input.appName)}</p>`,
          `        <h1>${escapeForJsTemplateLiteral(input.appName)} starter workspace</h1>`,
          `        <p className=\"summary\">${escapeForJsTemplateLiteral(input.productBrief)}</p>`,
          "      </section>",
          "      <section className=\"panel\">",
          "        <h2>Bootstrap checkpoints</h2>",
          "        <ul>",
          "          {checkpoints.map((checkpoint) => (",
          "            <li key={checkpoint}>{checkpoint}</li>",
          "          ))}",
          "        </ul>",
          "      </section>",
          "    </main>",
          "  );",
          "}"
        ].join("\n")
      ),
      writeFile(
        "client/src/styles.css",
        [
          ":root {",
          "  color-scheme: dark;",
          "  --bg: #08101e;",
          "  --panel: rgba(14, 22, 40, 0.9);",
          "  --line: rgba(144, 169, 214, 0.24);",
          "  --text: #f6f8fc;",
          "  --muted: #a5b5d0;",
          "  --accent: #facc15;",
          "}",
          "",
          "* {",
          "  box-sizing: border-box;",
          "}",
          "",
          "body {",
          "  margin: 0;",
          "  min-height: 100vh;",
          "  font-family: \"Avenir Next\", \"Segoe UI\", sans-serif;",
          "  background: linear-gradient(180deg, #14213d 0%, var(--bg) 68%);",
          "  color: var(--text);",
          "}",
          "",
          ".page {",
          "  display: grid;",
          "  gap: 1.5rem;",
          "  width: min(70rem, calc(100% - 3rem));",
          "  margin: 0 auto;",
          "  padding: 4rem 0;",
          "}",
          "",
          ".hero,",
          ".panel {",
          "  background: var(--panel);",
          "  border: 1px solid var(--line);",
          "  border-radius: 1.5rem;",
          "  padding: 1.5rem;",
          "}",
          "",
          ".eyebrow {",
          "  margin: 0 0 0.75rem;",
          "  text-transform: uppercase;",
          "  letter-spacing: 0.18em;",
          "  color: var(--accent);",
          "  font-size: 0.75rem;",
          "}",
          "",
          "h1,",
          "h2 {",
          "  margin: 0 0 1rem;",
          "}",
          "",
          ".summary,",
          "ul {",
          "  margin: 0;",
          "  color: var(--muted);",
          "}"
        ].join("\n")
      ),
      writeFile(
        "server/package.json",
        toJsonFile({
          name: `${input.repositoryName}-server`,
          private: true,
          version: "0.1.0",
          type: "module",
          scripts: {
            dev: "tsx watch src/index.ts",
            build: "tsc --project tsconfig.json",
            start: "node dist/index.js",
            typecheck: "tsc --project tsconfig.json --noEmit"
          },
          dependencies: {
            cors: "^2.8.5",
            express: "^4.21.0"
          },
          devDependencies: {
            "@types/cors": "^2.8.17",
            "@types/express": "^5.0.0",
            "@types/node": "^22.0.0",
            tsx: "^4.19.0",
            typescript: "^5.6.0"
          }
        })
      ),
      writeFile(
        "server/tsconfig.json",
        toJsonFile({
          extends: "../tsconfig.base.json",
          compilerOptions: {
            outDir: "dist"
          },
          include: ["src/**/*.ts"]
        })
      ),
      writeFile(
        "server/src/index.ts",
        [
          "import cors from \"cors\";",
          "import express from \"express\";",
          "",
          "const app = express();",
          "const port = Number(process.env.PORT ?? 4000);",
          "",
          "app.use(cors());",
          "app.use(express.json());",
          "",
          "app.get(\"/api/health\", (_request, response) => {",
          "  response.json({ status: \"ok\" });",
          "});",
          "",
          "app.listen(port, () => {",
          `  console.log(\"${escapeForDoubleQuotedString(input.appName)} server listening on port \${port}\");`,
          "});"
        ].join("\n")
      ),
      writeFile(
        ".env.example",
        ["PORT=4000", "CLIENT_URL=http://localhost:5173", "DATABASE_URL="].join("\n") + "\n"
      ),
      writeFile("README.md", buildReactExpressReadme(input))
    ]
  };
}

function writeFile(path: string, content: string): RuntimeWorkspacePlanOperation {
  return {
    kind: "write_file",
    path,
    content
  };
}

function toJsonFile(value: unknown) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function buildNextJsReadme(input: {
  appName: string;
  productBrief: string;
  dataProviderLabel: string;
}) {
  return [
    `# ${input.appName}`,
    "",
    input.productBrief.trim(),
    "",
    "## Bootstrap scaffold",
    "",
    "- Next.js App Router starter workspace",
    `- Data integration placeholder for ${input.dataProviderLabel}`,
    "- Local-first Factory bootstrap ready for the first implementation slice",
    "",
    "## Scripts",
    "",
    "- `npm install`",
    "- `npm run dev`",
    "- `npm run build`",
    "- `npm run typecheck`",
    "",
    "## Next steps",
    "",
    "- Replace the placeholder landing page with the first product flow.",
    "- Wire environment variables from `.env.example` when the data layer is implemented."
  ].join("\n");
}

function buildReactExpressReadme(input: {
  appName: string;
  productBrief: string;
}) {
  return [
    `# ${input.appName}`,
    "",
    input.productBrief.trim(),
    "",
    "## Bootstrap scaffold",
    "",
    "- React client workspace in `client/`",
    "- Express API workspace in `server/`",
    "- Local-first Factory bootstrap ready for the first implementation slice",
    "",
    "## Scripts",
    "",
    "- `npm install`",
    "- `npm run dev:client`",
    "- `npm run dev:server`",
    "- `npm run build`",
    "- `npm run typecheck`",
    "",
    "## Next steps",
    "",
    "- Replace the placeholder UI shell with the first user flow.",
    "- Add real persistence and API behavior after the repository foundation is in place."
  ].join("\n");
}

function escapeForDoubleQuotedString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function escapeForJsTemplateLiteral(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}

function escapeForHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
