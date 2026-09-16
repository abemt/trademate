import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { sign } from "hono/jwt";
import type { Env } from "../worker/context";
import { entryGateRoutes } from "../worker/entryGate";
import worker from "../worker/index";

class Statement {
  values: (string | number | null)[] = [];
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...values: (string | number | null)[]) { this.values = values; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { return { meta: this.db.prepare(this.sql).run(...this.values) }; }
}

/** In-memory SQLite with every migration applied, wrapped in a D1-shaped binding. */
export function fixture() {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../migrations/", import.meta.url);
  for (const filename of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(filename, directory), "utf8"));
  db.prepare("INSERT INTO accounts (id,label,type,starting_balance,active,archived,created_at) VALUES ('gate-test','Test','demo',10000,0,0,datetime('now'))").run();
  const env = { DB: {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } } as unknown as Env;
  const request = (route: string, value?: unknown) => entryGateRoutes.request(`http://localhost${route}`, value ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  } : undefined, env);
  return { db, env, request };
}

/** Authenticated call into the full worker (test-only signing key, never a real credential). */
export async function authedFetch(env: Env) {
  env.JWT_SECRET = "local-test-only-signing-key-not-a-real-credential";
  const token = await sign({ sub: "trader", exp: Math.floor(Date.now() / 1000) + 60 }, env.JWT_SECRET);
  return (path: string, init?: { method?: string; body?: unknown }) => worker.fetch(new Request(`http://localhost/api${path}`, {
    method: init?.method ?? "GET",
    headers: { "Content-Type": "application/json", Cookie: `tm_session=${token}` },
    body: init?.body === undefined ? undefined : JSON.stringify(init.body),
  }), env, {} as ExecutionContext);
}
