import type { AuditSession } from "../domain/audit";

export interface AuditRepository {
  listSessions(): Promise<AuditSession[]>;
  getSession(id: string): Promise<AuditSession | undefined>;
  saveSession(session: AuditSession): Promise<void>;
  saveSessions(sessions: AuditSession[]): Promise<void>;
  deleteSession(id: string): Promise<void>;
}
