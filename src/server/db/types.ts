export type Row = Record<string, unknown>;

/** Executor de SQL parametrizado (conexão avulsa ou transação). */
export interface Queryable {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface Db extends Queryable {
  /** Executa `fn` em uma transação; qualquer erro provoca ROLLBACK completo. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  exec(sql: string): Promise<void>;
  close(): Promise<void>;
  readonly driver: "pglite" | "postgres";
}
