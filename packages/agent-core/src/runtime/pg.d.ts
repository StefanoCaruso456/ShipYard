declare module "pg" {
  export class Pool {
    constructor(config?: {
      connectionString?: string;
    });

    query(
      text: string,
      values?: readonly unknown[]
    ): Promise<{
      rows: Record<string, unknown>[];
      rowCount: number | null;
    }>;
  }
}
