import { Pool } from "pg";

import { cloneRunRecord, type AgentRunRecord, type AgentRunStore } from "./types";

type QueryResultRow = Record<string, unknown>;

type PostgresQueryable = {
  query(
    text: string,
    values?: readonly unknown[]
  ): Promise<{
    rows: QueryResultRow[];
    rowCount: number | null;
  }>;
};

type CreatePostgresRunStoreOptions = {
  connectionString?: string;
  queryable?: PostgresQueryable;
  schemaName?: string;
  tableName?: string;
};

type RunRow = {
  run_json: AgentRunRecord | string;
};

export function createPostgresRunStore(
  options: CreatePostgresRunStoreOptions
): AgentRunStore {
  if (!options.queryable && !options.connectionString?.trim()) {
    throw new Error(
      "createPostgresRunStore requires either a queryable client or a connection string."
    );
  }

  const queryable =
    options.queryable ??
    new Pool({
      connectionString: options.connectionString?.trim()
    });
  const schemaName = sanitizeIdentifier(options.schemaName?.trim() || "public");
  const tableName = sanitizeIdentifier(options.tableName?.trim() || "agent_runs");
  const fullTableName = `${escapeIdentifier(schemaName)}.${escapeIdentifier(tableName)}`;
  const statusCreatedIndex = escapeIdentifier(`${tableName}_status_created_at_idx`);
  const createdIndex = escapeIdentifier(`${tableName}_created_at_idx`);

  let initialization: Promise<void> | null = null;

  async function ensureInitialized() {
    if (!initialization) {
      initialization = initialize().catch((error) => {
        initialization = null;
        throw error;
      });
    }

    await initialization;
  }

  async function initialize() {
    await queryable.query(`CREATE SCHEMA IF NOT EXISTS ${escapeIdentifier(schemaName)}`);
    await queryable.query(`
      CREATE TABLE IF NOT EXISTS ${fullTableName} (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        title TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL,
        started_at TIMESTAMPTZ NULL,
        completed_at TIMESTAMPTZ NULL,
        updated_at TIMESTAMPTZ NOT NULL,
        run_json JSONB NOT NULL
      )
    `);
    await queryable.query(`
      CREATE INDEX IF NOT EXISTS ${statusCreatedIndex}
      ON ${fullTableName} (status, created_at DESC)
    `);
    await queryable.query(`
      CREATE INDEX IF NOT EXISTS ${createdIndex}
      ON ${fullTableName} (created_at DESC)
    `);
  }

  return {
    async load() {
      await ensureInitialized();
      const result = await queryable.query(
        `SELECT run_json FROM ${fullTableName} ORDER BY created_at DESC`
      );

      return result.rows.map((row) => deserializeRunRow((row as RunRow).run_json));
    },
    async create(run) {
      await ensureInitialized();
      const normalized = cloneRunRecord(run);

      await queryable.query(
        `
          INSERT INTO ${fullTableName} (
            id,
            status,
            title,
            created_at,
            started_at,
            completed_at,
            updated_at,
            run_json
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        `,
        [
          normalized.id,
          normalized.status,
          normalized.title,
          normalized.createdAt,
          normalized.startedAt,
          normalized.completedAt,
          new Date().toISOString(),
          JSON.stringify(normalized)
        ]
      );
    },
    async update(run) {
      await ensureInitialized();
      const normalized = cloneRunRecord(run);
      const result = await queryable.query(
        `
          UPDATE ${fullTableName}
          SET
            status = $2,
            title = $3,
            created_at = $4,
            started_at = $5,
            completed_at = $6,
            updated_at = $7,
            run_json = $8::jsonb
          WHERE id = $1
        `,
        [
          normalized.id,
          normalized.status,
          normalized.title,
          normalized.createdAt,
          normalized.startedAt,
          normalized.completedAt,
          new Date().toISOString(),
          JSON.stringify(normalized)
        ]
      );

      if (!result.rowCount) {
        throw new Error(`Cannot update unknown run: ${normalized.id}`);
      }
    },
    async get(id) {
      await ensureInitialized();
      const result = await queryable.query(
        `SELECT run_json FROM ${fullTableName} WHERE id = $1`,
        [id]
      );
      const row = result.rows[0] as RunRow | undefined;

      return row ? deserializeRunRow(row.run_json) : null;
    },
    async list() {
      await ensureInitialized();
      const result = await queryable.query(
        `SELECT run_json FROM ${fullTableName} ORDER BY created_at DESC`
      );

      return result.rows.map((row) => deserializeRunRow((row as RunRow).run_json));
    }
  };
}

function deserializeRunRow(value: AgentRunRecord | string) {
  if (typeof value === "string") {
    return cloneRunRecord(JSON.parse(value) as AgentRunRecord);
  }

  return cloneRunRecord(value);
}

function sanitizeIdentifier(value: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }

  return value;
}

function escapeIdentifier(value: string) {
  return `"${value.replace(/"/g, "\"\"")}"`;
}
