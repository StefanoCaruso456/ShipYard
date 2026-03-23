import { useEffect, useState } from "react";

type ProjectPayload = {
  name: string;
  tagline: string;
  what: string[];
  why: string[];
  how: string[];
  outcome: string[];
  nextStep: string;
};

const emptyState: ProjectPayload = {
  name: "Shipyard",
  tagline: "Preparing the repo...",
  what: [],
  why: [],
  how: [],
  outcome: [],
  nextStep: "Complete PRESEARCH before implementation begins."
};

function App() {
  const [data, setData] = useState<ProjectPayload>(emptyState);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadProject = async () => {
      try {
        const response = await fetch("/api/project");
        if (!response.ok) {
          throw new Error(`Request failed with ${response.status}`);
        }

        const payload = (await response.json()) as ProjectPayload;
        setData(payload);
      } catch (requestError) {
        setError("Server not running yet. Start the API to see the live brief.");
      } finally {
        setLoading(false);
      }
    };

    void loadProject();
  }, []);

  return (
    <main className="app-shell">
      <section className="hero">
        <p className="eyebrow">Gauntlet Sprint Setup</p>
        <h1>{data.name}</h1>
        <p className="tagline">{data.tagline}</p>
        <div className="status-row">
          <span className="status-pill">{loading ? "Loading brief" : "Repo scaffolded"}</span>
          <span className="status-pill muted">{data.nextStep}</span>
        </div>
        {error ? <p className="notice">{error}</p> : null}
      </section>

      <section className="grid">
        <InfoCard title="What" items={data.what} />
        <InfoCard title="Why" items={data.why} />
        <InfoCard title="How" items={data.how} />
        <InfoCard title="Outcome" items={data.outcome} />
      </section>
    </main>
  );
}

function InfoCard({ title, items }: { title: string; items: string[] }) {
  return (
    <article className="card">
      <h2>{title}</h2>
      <ul>
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

export default App;

