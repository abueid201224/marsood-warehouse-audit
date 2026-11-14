/** تسمية ملفات النسخ الاحتياطي وسياسة الاحتفاظ (بلا اعتماد على React Native). */
export const BACKUP_PREFIX = "marsood-backup-";
export const BACKUP_KEEP = 7;

export function backupBaseName(day: string): string {
  return `${BACKUP_PREFIX}${day}`;
}

export function isBackupName(name: string): boolean {
  return /^marsood-backup-\d{4}-\d{2}-\d{2}(?:\s?\(\d+\))?\.json$/i.test(name);
}

/** الأسماء الأقدم من آخر `keep` يوماً (للحذف). التكرار بنفس اليوم يُعد الأحدث أولاً. */
export function backupsToPrune(names: string[], keep = BACKUP_KEEP): string[] {
  const list = names.filter(isBackupName).sort((a, b) => b.localeCompare(a));
  return list.slice(keep);
}

/** هل يلزم نسخ الآن؟ start: مرة يومياً؛ event: بفاصل 10 دقائق؛ manual: دائماً. */
export function shouldBackup(reason: "start" | "event" | "manual", lastAt: string | null, now: Date, dayOf: (iso: string) => string): boolean {
  if (reason === "manual" || !lastAt) return true;
  const last = new Date(lastAt);
  if (Number.isNaN(last.getTime())) return true;
  if (reason === "start") return dayOf(lastAt) !== dayOf(now.toISOString());
  return now.getTime() - last.getTime() >= 10 * 60_000;
}
