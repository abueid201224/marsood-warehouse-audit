import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AuditSession } from "../domain/audit";
import type { AuditRepository } from "./repository.types";

const STORAGE_KEY = "marsood.audit.sessions.v1";

async function loadAll(): Promise<AuditSession[]> {
  const stored = await AsyncStorage.getItem(STORAGE_KEY);
  if (!stored) return [];
  try {
    const parsed = JSON.parse(stored) as AuditSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    throw new Error("تعذر قراءة سجل الجلسات المحلي؛ لم يتم استبدال البيانات.");
  }
}

async function saveAll(sessions: AuditSession[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(sessions));
}

async function mergeSessions(input: AuditSession[]): Promise<void> {
  const sessions = await loadAll();
  for (const session of input) {
    const index = sessions.findIndex((candidate) => candidate.id === session.id);
    if (index < 0) sessions.push(session);
    else sessions[index] = session;
  }
  await saveAll(sessions);
}

export const auditRepository: AuditRepository = {
  async listSessions() {
    return (await loadAll()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },
  async getSession(id) {
    return (await loadAll()).find((session) => session.id === id);
  },
  async saveSession(session) {
    await mergeSessions([session]);
  },
  async saveSessions(sessions) {
    await mergeSessions(sessions);
  },
  async deleteSession(id) {
    const sessions = await loadAll();
    await saveAll(sessions.filter((session) => session.id !== id));
  },
};
