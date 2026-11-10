import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { AuditEngine, type Db, type SqlValue } from "../../lib/core/engine";

// vite يحوّل node:sqlite إلى «sqlite» غير الموجودة؛ require يتجاوز ذلك
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as { DatabaseSync: new (path: string) => DatabaseSyncType };

/** محوّل node:sqlite لاختبار المحرك على SQLite حقيقية دون جهاز. */
export function memoryDb(): Db {
  const db = new DatabaseSync(":memory:");
  return {
    async exec(sql) {
      db.exec(sql);
    },
    async run(sql, params: SqlValue[] = []) {
      const result = db.prepare(sql).run(...params);
      return { lastId: Number(result.lastInsertRowid), changes: Number(result.changes) };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return db.prepare(sql).all(...params) as T[];
    },
  };
}

export async function makeEngine(clock?: () => string) {
  let tick = 0;
  // ساعة اصطناعية متزايدة لضمان ترتيب ثابت للأحداث
  const engine = new AuditEngine(memoryDb(), clock ?? (() => new Date(Date.UTC(2026, 10, 5, 8, 0, tick++)).toISOString()));
  await engine.init();
  return engine;
}
