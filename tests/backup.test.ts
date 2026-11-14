import { describe, expect, it } from "vitest";
import { backupBaseName, backupsToPrune, isBackupName, shouldBackup } from "../lib/backup/names";

const day = (iso: string) => iso.slice(0, 10);

describe("النسخ الاحتياطي: التسمية والاحتفاظ", () => {
  it("يتعرف على أسماء النسخ فقط", () => {
    expect(isBackupName("marsood-backup-2026-11-12.json")).toBe(true);
    expect(isBackupName("marsood-backup-2026-11-12 (1).json")).toBe(true);
    expect(isBackupName("invoices.xlsx")).toBe(false);
    expect(backupBaseName("2026-11-12")).toBe("marsood-backup-2026-11-12");
  });
  it("يحتفظ بآخر 7 ولا يمس غير النسخ", () => {
    const names = Array.from({ length: 10 }, (_, i) => `marsood-backup-2026-11-${String(i + 1).padStart(2, "0")}.json`).concat("invoices.xlsx");
    const pruned = backupsToPrune(names);
    expect(pruned).toEqual(["marsood-backup-2026-11-03.json", "marsood-backup-2026-11-02.json", "marsood-backup-2026-11-01.json"]);
  });
  it("سياسة التوقيت", () => {
    const now = new Date("2026-11-12T10:00:00Z");
    expect(shouldBackup("manual", "2026-11-12T09:59:00Z", now, day)).toBe(true);
    expect(shouldBackup("start", null, now, day)).toBe(true);
    expect(shouldBackup("start", "2026-11-12T01:00:00Z", now, day)).toBe(false);
    expect(shouldBackup("start", "2026-11-11T23:00:00Z", now, day)).toBe(true);
    expect(shouldBackup("event", "2026-11-12T09:55:00Z", now, day)).toBe(false);
    expect(shouldBackup("event", "2026-11-12T09:40:00Z", now, day)).toBe(true);
  });
});
