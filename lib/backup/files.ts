import * as FS from "expo-file-system/legacy";
import { localDay, type AuditEngine, type Snapshot } from "@/lib/core/engine";
import { SYNC_FOLDER_KEY } from "@/lib/sync/folder";
import { nameFromUri } from "@/lib/sync/select";
import { backupBaseName, backupsToPrune, isBackupName, shouldBackup } from "./names";

export const BACKUP_FOLDER_KEY = "backup:folder";
export const BACKUP_LAST_KEY = "backup:last_at";
export const BACKUP_LAST_WHERE_KEY = "backup:last_where";

export async function pickBackupFolder(): Promise<string | null> {
  const result = await FS.StorageAccessFramework.requestDirectoryPermissionsAsync();
  return result.granted ? result.directoryUri : null;
}

export interface BackupResult { name: string; where: string; rows: number }

async function writeToSaf(folder: string, base: string, json: string): Promise<void> {
  const SAF = FS.StorageAccessFramework;
  for (const uri of await SAF.readDirectoryAsync(folder)) {
    const name = nameFromUri(uri);
    if (name === `${base}.json`) await FS.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
  const file = await SAF.createFileAsync(folder, base, "application/json");
  await FS.writeAsStringAsync(file, json);
  const stale = backupsToPrune((await SAF.readDirectoryAsync(folder)).map(nameFromUri));
  for (const uri of await SAF.readDirectoryAsync(folder)) {
    if (stale.includes(nameFromUri(uri))) await FS.deleteAsync(uri, { idempotent: true }).catch(() => undefined);
  }
}

async function writeToPrivate(base: string, json: string): Promise<string> {
  const dir = `${FS.documentDirectory}backups/`;
  await FS.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
  await FS.writeAsStringAsync(`${dir}${base}.json`, json);
  for (const name of backupsToPrune(await FS.readDirectoryAsync(dir))) await FS.deleteAsync(`${dir}${name}`, { idempotent: true }).catch(() => undefined);
  return dir;
}

/** ينسخ بيانات التدقيق إلى مجلد النسخ (أو مجلد المزامنة إن لم يُحدَّد)، وإلا إلى تخزين التطبيق الخاص. */
export async function runBackup(engine: AuditEngine, reason: "start" | "event" | "manual"): Promise<BackupResult | null> {
  const lastAt = await engine.getSetting(BACKUP_LAST_KEY);
  if (!shouldBackup(reason, lastAt, new Date(), localDay)) return null;
  try {
    const snapshot = await engine.exportSnapshot();
    const json = JSON.stringify(snapshot);
    const base = backupBaseName(localDay(snapshot.createdAt));
    const folder = (await engine.getSetting(BACKUP_FOLDER_KEY)) || (await engine.getSetting(SYNC_FOLDER_KEY));
    let where = "تخزين التطبيق الخاص (يُحذف مع إلغاء التثبيت)";
    let saved = false;
    if (folder) {
      try {
        await writeToSaf(folder, base, json);
        where = "المجلد المختار";
        saved = true;
      } catch {
        // إذن المجلد انتهى؛ يُنسخ للتخزين الخاص ويُنبَّه المشرف
      }
    }
    if (!saved) await writeToPrivate(base, json);
    const rows = Object.values(snapshot.tables).reduce((sum, t) => sum + t.rows.length, 0);
    await engine.setSetting(BACKUP_LAST_KEY, snapshot.createdAt);
    await engine.setSetting(BACKUP_LAST_WHERE_KEY, where);
    await engine.recordEvent("backup", `${base}.json`, `${reason} • ${rows} صف • ${where}`);
    return { name: `${base}.json`, where, rows };
  } catch (cause) {
    await engine.recordEvent("backup_failed", null, cause instanceof Error ? cause.message.slice(0, 120) : "خطأ").catch(() => undefined);
    throw cause;
  }
}

/** نسخ في الخلفية دون إظهار أخطاء للمشغّل (الفشل يُسجَّل في سجل التدقيق). */
export function backupQuietly(engine: AuditEngine, reason: "start" | "event"): void {
  runBackup(engine, reason).catch(() => undefined);
}

export async function readBackupFile(uri: string): Promise<Snapshot> {
  const text = await FS.readAsStringAsync(uri);
  try {
    return JSON.parse(text) as Snapshot;
  } catch {
    throw new Error("الملف ليس نسخة احتياطية صالحة (JSON تالف).");
  }
}

export { isBackupName };
