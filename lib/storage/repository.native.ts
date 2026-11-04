import { openDatabaseAsync, type SQLiteDatabase } from "expo-sqlite";
import type { AuditSession } from "../domain/audit";
import type { AuditRepository } from "./repository.types";

let databasePromise: Promise<SQLiteDatabase> | undefined;

async function getDatabase(): Promise<SQLiteDatabase> {
  if (!databasePromise) {
    const opening = (async () => {
      const db = await openDatabaseAsync("marsood-audit.db");
      await db.execAsync(
        "PRAGMA journal_mode = WAL; CREATE TABLE IF NOT EXISTS audit_sessions (id TEXT PRIMARY KEY NOT NULL, updated_at TEXT NOT NULL, payload TEXT NOT NULL);",
      );
      return db;
    })();
    databasePromise = opening.catch((cause: unknown) => {
      databasePromise = undefined;
      throw cause;
    });
  }
  return databasePromise;
}

async function saveSessions(sessions: AuditSession[]): Promise<void> {
  const db = await getDatabase();
  await db.withTransactionAsync(async () => {
    for (const session of sessions) {
      await db.runAsync(
        "INSERT OR REPLACE INTO audit_sessions (id, updated_at, payload) VALUES (?, ?, ?)",
        session.id,
        session.updatedAt,
        JSON.stringify(session),
      );
    }
  });
}

export const auditRepository: AuditRepository = {
  async listSessions() {
    const db = await getDatabase();
    const rows = await db.getAllAsync<{ payload: string }>(
      "SELECT payload FROM audit_sessions ORDER BY updated_at DESC",
    );
    return rows.map((row) => JSON.parse(row.payload) as AuditSession);
  },

  async getSession(id) {
    const db = await getDatabase();
    const row = await db.getFirstAsync<{ payload: string }>(
      "SELECT payload FROM audit_sessions WHERE id = ?",
      id,
    );
    return row ? (JSON.parse(row.payload) as AuditSession) : undefined;
  },

  async saveSession(session) {
    await saveSessions([session]);
  },

  async saveSessions(sessions) {
    await saveSessions(sessions);
  },

  async deleteSession(id) {
    const db = await getDatabase();
    await db.runAsync("DELETE FROM audit_sessions WHERE id = ?", id);
  },
};
