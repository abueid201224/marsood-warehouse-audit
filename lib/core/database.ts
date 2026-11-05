import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import { AuditEngine, type Db, type SqlValue } from "./engine";

function wrap(db: SQLiteDatabase): Db {
  return {
    async exec(sql) {
      await db.execAsync(sql);
    },
    async run(sql, params = []) {
      const result = await db.runAsync(sql, params as SqlValue[]);
      return { lastId: Number(result.lastInsertRowId), changes: result.changes };
    },
    async all<T>(sql: string, params: SqlValue[] = []) {
      return (await db.getAllAsync<T>(sql, params)) as T[];
    },
  };
}

let enginePromise: Promise<AuditEngine> | undefined;

/** محرك التدقيق الوحيد للتطبيق؛ يفتح قاعدة SQLite محلية ويهيئ المخطط مرة واحدة. */
export function getEngine(): Promise<AuditEngine> {
  if (!enginePromise) {
    const opening = (async () => {
      const db = await openDatabaseAsync("marsood-v2.db");
      const engine = new AuditEngine(wrap(db));
      await engine.init();
      return engine;
    })();
    enginePromise = opening.catch((cause: unknown) => {
      enginePromise = undefined;
      throw cause;
    });
  }
  return enginePromise;
}
