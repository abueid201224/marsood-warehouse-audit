import { MAX_ITEM_CODE_LENGTH, codeKey, fitsItemCode, normalizeCode } from "./codes";
import type { ImportRow } from "./importer";
import { hashPin, randomSalt } from "./sha256";

/* ------------------------------------------------------------------ */
/* واجهة قاعدة البيانات (expo-sqlite على Android، node:sqlite في الاختبارات) */
/* ------------------------------------------------------------------ */
export type SqlValue = string | number | null;
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlValue[]): Promise<{ lastId: number; changes: number }>;
  all<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
}

export type InvoiceStatus = "new" | "open" | "posted" | "closed";
export type ScanKind = "ok" | "over" | "wrong" | "unknown";

export interface InvoiceRow {
  order_key: string;
  order_no: string;
  invoices: string | null;
  status: InvoiceStatus;
  opened_at: string | null;
  closed_at: string | null;
  posted_at: string | null;
  item_count: number;
  total_qty: number;
  done_qty: number;
  done_items: number;
  short_items: number;
  over_items: number;
  wrong_scans: number;
  over_scans: number;
}
export interface InvoiceView extends InvoiceRow {
  /** نسبة التقدم 0..100 بحسب الوحدات الممسوحة (بحد أقصى الكمية المسجلة) إلى إجمالي الوحدات. */
  progress: number;
}
export interface ItemRow {
  /** ترتيب البند كما ورد في شيت Excel. */
  seq: number;
  order_key: string;
  item_key: string;
  item_code: string;
  unit: string | null;
  /** بيان الصنف (ITEM DESQ) من ملف الاستيراد. */
  item_desc: string | null;
  qty: number;
  scanned: number;
}
export type ItemState = "pending" | "partial" | "done" | "over";
export function itemState(item: Pick<ItemRow, "qty" | "scanned">): ItemState {
  if (item.scanned > item.qty) return "over";
  if (item.scanned === item.qty) return "done";
  return item.scanned > 0 ? "partial" : "pending";
}

export interface Stats {
  total: number;
  closed: number;
  posted: number;
  open: number;
  fresh: number;
  /** الفواتير غير المنتهية = الإجمالي - المنتهية. */
  remaining: number;
  unknownScans: number;
  wrongScans: number;
  overScans: number;
  timeline: string[];
}

export type ScanResult =
  | { type: "empty" }
  | { type: "item"; kind: "ok" | "over" | "wrong"; code: string; orderKey: string; scanned?: number; qty?: number; desc?: string }
  | { type: "order-opened"; orderKey: string; orderNo: string; readonly: boolean; resumed: boolean; left?: LeftInvoice }
  | { type: "same-order"; orderKey: string }
  | { type: "order-not-found"; code: string }
  /** فاتورة غير مسجلة في جدول اليوم (استُوردت في يوم سابق ولم تبدأ مراجعتها): لا يُقبل مسحها. */
  | { type: "not-today"; code: string; orderKey: string; orderNo: string; day: string }
  | { type: "no-invoice"; code: string }
  | { type: "locked"; code: string; orderKey: string }
  /** رقم طلب/فاتورة جديد قبل اكتمال الفاتورة الحالية: لا يبدأ مسح جديد. */
  | { type: "blocked"; code: string; orderNo: string; shortItems: number }
  /** الطلب الممسوح فاتورته منتهية ومراجعة سابقاً: يُسأل المستخدم عن إعادة الفتح أو التخطي. */
  | { type: "already-closed"; code: string; orderKey: string; orderNo: string };

/** أرقام الطلبات والفواتير تبدأ من اليسار بـ 200 أو 204. */
export const ORDER_PREFIXES = ["200", "204"] as const;
export function looksLikeOrderNumber(code: string): boolean {
  return code.length > MAX_ITEM_CODE_LENGTH && ORDER_PREFIXES.some((prefix) => code.startsWith(prefix));
}

export interface LeftInvoice {
  orderKey: string;
  orderNo: string;
  outcome: "closed" | "posted" | "released";
  shortItems: number;
}

export interface ImportSummary {
  inserted: number;
  orders: number;
  replaced: number;
  skippedOrders: string[];
}

export interface ErrorReportRow {
  kind: "wrong" | "over";
  orderNo: string;
  invoices: string;
  code: string;
  count: number;
  firstAt: string;
  expected: number | null;
  scanned: number | null;
  operator: string;
}
export interface ShortageRow {
  orderNo: string;
  invoices: string;
  code: string;
  unit: string;
  expected: number;
  scanned: number;
}
export interface UnknownScanRow {
  code: string;
  at: string;
}
export interface ErrorReport {
  generatedAt: string;
  stats: Stats;
  wrong: ErrorReportRow[];
  over: ErrorReportRow[];
  shortages: ShortageRow[];
  unknown: UnknownScanRow[];
  kpis: Kpis;
  printLog: PrintLogRow[];
}

export type PrintKind = "invoice" | "label";
export type PrintStatus = "pending" | "printing" | "done" | "failed" | "missing";
export const PRINT_SUFFIX: Record<PrintKind, string> = { invoice: "_b_Invoice.pdf", label: "_c_Label.pdf" };

export interface PrintConfig {
  enabled: boolean;
  folder: string | null;
  invoicePrinter: string | null;
  labelPrinter: string | null;
  operator: string | null;
}
export interface PrintFileEntry {
  refKey: string;
  kind: PrintKind;
  name: string;
  uri: string;
}
export interface PrintJob {
  orderKey: string;
  kind: PrintKind;
  attempts: number;
  /** الأرقام المرجعية بترتيب الأولوية: الرقم الممسوح، ثم رقم الطلب، ثم أرقام الفواتير. */
  refs: string[];
}
export interface PrintLogRow {
  orderNo: string;
  invoices: string;
  kind: PrintKind;
  status: PrintStatus;
  detail: string;
  fileName: string;
  updatedAt: string;
}
export interface OperatorStat {
  operator: string;
  ok: number;
  over: number;
  wrong: number;
  /** مدة النشاط الفعلية بالثواني (الفجوات حتى دقيقتين بين مسحتين متتاليتين). */
  activeSeconds: number;
  closed: number;
  posted: number;
  firstAt: string;
  lastAt: string;
}
/** أقصى عدد محاولات للطباعة التلقائية قبل التوقف وطلب تدخل المشرف. */
export const PRINT_MAX_ATTEMPTS = 6;

export type PrintSummary = Record<PrintStatus, number>;

/** مؤشرات الأداء اللوجستية. null = لا بيانات كافية بعد. */
export interface Kpis {
  acceptedUnits: number;
  /** نسبة المسحات الصحيحة من أول مرة = المقبول ÷ (المقبول + الزائد + الخطأ). */
  accuracy: number | null;
  /** First Pass Yield: الفواتير المنتهية بلا أي خطأ تجهيز أو زيادة ÷ المنتهية. */
  firstPassYield: number | null;
  avgCycleSeconds: number | null;
  /** ساعات العمل الفعلي (الفجوات الأطول من دقيقتين بين المسحات لا تُحتسب). */
  activeHours: number;
  unitsPerHour: number | null;
  invoicesPerHour: number | null;
  remainingUnits: number;
  etaMinutes: number | null;
  /** أكثر الأكواد تكراراً في الأخطاء (باريتو). */
  pareto: Array<{ code: string; kind: "wrong" | "over"; count: number }>;
  oldestPostedAt: string | null;
}

/* ------------------------------------------------------------------ */
/* المخطط: البيانات الخام في lines، والفواتير تُستخلص بالاستعلامات (Views) */
/* ------------------------------------------------------------------ */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS imports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_name TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  row_count INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  import_id INTEGER,
  src_row INTEGER,
  order_no TEXT NOT NULL,
  order_key TEXT NOT NULL,
  invoice_no TEXT NOT NULL DEFAULT '',
  invoice_key TEXT NOT NULL DEFAULT '',
  item_code TEXT NOT NULL,
  item_key TEXT NOT NULL,
  unit TEXT NOT NULL DEFAULT '',
  item_desc TEXT NOT NULL DEFAULT '',
  qty REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_lines_order ON lines(order_key, item_key);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON lines(invoice_key);
CREATE TABLE IF NOT EXISTS invoice_state (
  order_key TEXT PRIMARY KEY NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  opened_at TEXT,
  closed_at TEXT,
  posted_at TEXT,
  scanned_ref TEXT
);
CREATE TABLE IF NOT EXISTS scans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_key TEXT,
  item_key TEXT,
  code TEXT NOT NULL,
  kind TEXT NOT NULL,
  at TEXT NOT NULL,
  operator TEXT
);
CREATE INDEX IF NOT EXISTS idx_scans_order ON scans(order_key, item_key, kind);
CREATE INDEX IF NOT EXISTS idx_scans_at ON scans(at);
CREATE INDEX IF NOT EXISTS idx_scans_kind ON scans(kind, code);
CREATE TABLE IF NOT EXISTS app_state (key TEXT PRIMARY KEY NOT NULL, value TEXT);
CREATE TABLE IF NOT EXISTS operators (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  salt TEXT NOT NULL,
  pin_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'operator',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  operator TEXT,
  event TEXT NOT NULL,
  ref TEXT,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, 'audit log is append-only'); END;
CREATE TABLE IF NOT EXISTS print_files (
  ref_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  uri TEXT NOT NULL,
  PRIMARY KEY (ref_key, kind)
);
CREATE TABLE IF NOT EXISTS print_jobs (
  order_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  file_name TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (order_key, kind)
);

DROP VIEW IF EXISTS v_invoice_stats;
DROP VIEW IF EXISTS v_item_progress;
DROP VIEW IF EXISTS v_items;
DROP VIEW IF EXISTS v_orders;

-- الطلبات/الفواتير: صف لكل رقم طلب (كما في البوليصة) مع أرقام فواتيره
CREATE VIEW v_orders AS
SELECT order_key,
       MIN(order_no) AS order_no,
       group_concat(DISTINCT NULLIF(invoice_no, '')) AS invoices
FROM lines
GROUP BY order_key;

-- بنود كل طلب: تُجمع الأسطر المتكررة لنفس الكود
CREATE VIEW v_items AS
SELECT order_key, item_key,
       MIN(id) AS seq,
       MIN(item_code) AS item_code,
       group_concat(DISTINCT NULLIF(unit, '')) AS unit,
       MIN(NULLIF(item_desc, '')) AS item_desc,
       SUM(qty) AS qty
FROM lines
GROUP BY order_key, item_key;

-- تقدم كل بند: عدد المسحات المقبولة (ok + over)
CREATE VIEW v_item_progress AS
SELECT i.order_key, i.item_key, i.seq, i.item_code, i.unit, i.item_desc, i.qty,
       COALESCE(s.scanned, 0) AS scanned
FROM v_items i
LEFT JOIN (
  SELECT order_key, item_key, COUNT(*) AS scanned
  FROM scans WHERE kind IN ('ok', 'over')
  GROUP BY order_key, item_key
) s ON s.order_key = i.order_key AND s.item_key = i.item_key;

-- إحصاءات كل فاتورة
CREATE VIEW v_invoice_stats AS
SELECT o.order_key, o.order_no, o.invoices,
       COALESCE(st.status, 'new') AS status,
       st.opened_at, st.closed_at, st.posted_at,
       COUNT(p.item_key) AS item_count,
       COALESCE(SUM(p.qty), 0) AS total_qty,
       COALESCE(SUM(MIN(p.scanned, p.qty)), 0) AS done_qty,
       COALESCE(SUM(CASE WHEN p.scanned >= p.qty THEN 1 ELSE 0 END), 0) AS done_items,
       COALESCE(SUM(CASE WHEN p.scanned < p.qty THEN 1 ELSE 0 END), 0) AS short_items,
       COALESCE(SUM(CASE WHEN p.scanned > p.qty THEN 1 ELSE 0 END), 0) AS over_items,
       (SELECT COUNT(*) FROM scans x WHERE x.order_key = o.order_key AND x.kind = 'wrong') AS wrong_scans,
       (SELECT COUNT(*) FROM scans x WHERE x.order_key = o.order_key AND x.kind = 'over') AS over_scans
FROM v_orders o
LEFT JOIN invoice_state st ON st.order_key = o.order_key
LEFT JOIN v_item_progress p ON p.order_key = o.order_key
GROUP BY o.order_key;
`;

/** فاتورة مفتوحة بدأ مسحها ولم تكتمل: لا يجوز بدء مسح جديد قبلها. */
function isBlocking(invoice: InvoiceView): boolean {
  const touched = invoice.done_qty > 0 || invoice.wrong_scans > 0 || invoice.over_scans > 0;
  return invoice.status === "open" && invoice.short_items > 0 && touched;
}

/** تاريخ اليوم المحلي (YYYY-MM-DD) لقيمة ISO. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toView(row: InvoiceRow): InvoiceView {
  const progress = row.total_qty > 0 ? Math.round((row.done_qty / row.total_qty) * 100) : 0;
  return { ...row, progress };
}

export type Role = "supervisor" | "operator";
export interface Session { id: number; name: string; role: Role }
export interface OperatorRow { id: number; name: string; role: Role; active: number }
export interface AuditRow { id: number; at: string; operator: string | null; event: string; ref: string | null; detail: string | null }
/** الجداول التي تُنسخ احتياطياً وتُستعاد (الإعدادات، البيانات، الطباعة). */
export const SNAPSHOT_TABLES = ["imports", "lines", "invoice_state", "scans", "app_state", "print_files", "print_jobs"] as const;
export interface Snapshot {
  app: "marsood";
  format: 1;
  createdAt: string;
  tables: Record<string, { columns: string[]; rows: SqlValue[][] }>;
}

export class AuditEngine {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly db: Db,
    private readonly now: () => string = () => new Date().toISOString(),
  ) {}

  /** يسلسل كل العمليات لتفادي تداخل المسحات السريعة. */
  private enqueue<T>(task: () => Promise<T>): Promise<T> {
    const run = this.chain.then(task, task);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async tx<T>(task: () => Promise<T>): Promise<T> {
    await this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = await task();
      await this.db.exec("COMMIT");
      return result;
    } catch (error) {
      await this.db.exec("ROLLBACK").catch(() => undefined);
      throw error;
    }
  }

  init(): Promise<void> {
    return this.enqueue(async () => {
      await this.db.exec("PRAGMA journal_mode = WAL;");
      // ترقية الجدول القديم قبل إعادة إنشاء الـ Views التي تعتمد على العمود الجديد
      const existing = await this.db.all<{ name: string }>("PRAGMA table_info(lines)");
      if (existing.length > 0) await this.addColumnIfMissing("lines", "item_desc", "TEXT NOT NULL DEFAULT ''");
      await this.db.exec(SCHEMA);
      // ترقية قواعد البيانات المنشأة بإصدار سابق
      await this.addColumnIfMissing("scans", "operator", "TEXT");
      await this.addColumnIfMissing("invoice_state", "scanned_ref", "TEXT");
      // مهمة طباعة قُطعت بإغلاق التطبيق تعود إلى الانتظار
      await this.db.run("UPDATE print_jobs SET status = 'pending' WHERE status = 'printing'");
    });
  }

  private async addColumnIfMissing(table: string, column: string, type: string) {
    const columns = await this.db.all<{ name: string }>(`PRAGMA table_info(${table})`);
    if (!columns.some((c) => c.name === column)) await this.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }

  /* ----------------------------- الاستيراد ----------------------------- */

  importRows(rows: ImportRow[], fileName: string): Promise<ImportSummary> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession();
        const at = this.now();
        const byOrder = new Map<string, ImportRow[]>();
        for (const row of rows) {
          const key = codeKey(row.orderNo);
          const list = byOrder.get(key) ?? [];
          list.push(row);
          byOrder.set(key, list);
        }
        const imp = await this.db.run("INSERT INTO imports (file_name, imported_at, row_count) VALUES (?, ?, ?)", [fileName, at, rows.length]);
        const skippedOrders: string[] = [];
        let replaced = 0;
        let inserted = 0;
        for (const [key, list] of byOrder) {
          const started = await this.db.all<{ n: number }>(
            `SELECT (SELECT COUNT(*) FROM scans WHERE order_key = ?1)
                  + (SELECT COUNT(*) FROM invoice_state WHERE order_key = ?1 AND status <> 'new') AS n`,
            [key],
          );
          if ((started[0]?.n ?? 0) > 0) {
            skippedOrders.push(list[0].orderNo);
            continue;
          }
          const existing = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM lines WHERE order_key = ?", [key]);
          if ((existing[0]?.n ?? 0) > 0) {
            replaced += 1;
            await this.db.run("DELETE FROM lines WHERE order_key = ?", [key]);
          }
          for (let start = 0; start < list.length; start += 50) {
            const chunk = list.slice(start, start + 50);
            const placeholders = chunk.map(() => "(?,?,?,?,?,?,?,?,?,?,?)").join(",");
            const params: SqlValue[] = [];
            for (const row of chunk) {
              params.push(imp.lastId, row.sourceRow, row.orderNo, key, row.invoiceNo, codeKey(row.invoiceNo), row.itemCode, codeKey(row.itemCode), row.unit, row.desc ?? "", row.qty);
            }
            await this.db.run(
              `INSERT INTO lines (import_id, src_row, order_no, order_key, invoice_no, invoice_key, item_code, item_key, unit, item_desc, qty) VALUES ${placeholders}`,
              params,
            );
            inserted += chunk.length;
          }
        }
        await this.audit("import", fileName, `${inserted} سطر / ${byOrder.size - skippedOrders.length} طلب / استبدال ${replaced} / تخطي ${skippedOrders.length}`);
        return { inserted, orders: byOrder.size - skippedOrders.length, replaced, skippedOrders };
      }),
    );
  }

  /** يمسح كل البيانات (بدء يوم/دفعة جديدة). */
  resetAll(): Promise<void> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession("supervisor");
        await this.audit("reset", null, "مسح كل بيانات الجلسة");
        for (const table of ["scans", "invoice_state", "lines", "imports", "print_jobs"]) {
          await this.db.run(`DELETE FROM ${table}`);
        }
        // الإعدادات (الطابعات، المجلد، المراجع) وفهرس PDF يبقيان؛ يُمسح فقط مؤشر الفاتورة الحالية
        await this.db.run("DELETE FROM app_state WHERE key = 'current_order'");
      }),
    );
  }

  /* ------------------------------- القراءة ------------------------------ */

  getStats(): Promise<Stats> {
    return this.enqueue(() => this.readStats());
  }

  private async readStats(): Promise<Stats> {
    const [counts] = await this.db.all<{ total: number; closed: number; posted: number; open: number; fresh: number }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(CASE WHEN COALESCE(st.status,'new') = 'closed' THEN 1 ELSE 0 END), 0) AS closed,
              COALESCE(SUM(CASE WHEN st.status = 'posted' THEN 1 ELSE 0 END), 0) AS posted,
              COALESCE(SUM(CASE WHEN st.status = 'open' THEN 1 ELSE 0 END), 0) AS open,
              COALESCE(SUM(CASE WHEN st.status IS NULL OR st.status = 'new' THEN 1 ELSE 0 END), 0) AS fresh
       FROM v_orders o LEFT JOIN invoice_state st ON st.order_key = o.order_key`,
    );
    const [errs] = await this.db.all<{ wrong: number; over: number; unknown: number }>(
      `SELECT COALESCE(SUM(kind = 'wrong'), 0) AS wrong,
              COALESCE(SUM(kind = 'over'), 0) AS over,
              COALESCE(SUM(kind = 'unknown'), 0) AS unknown
       FROM scans`,
    );
    const timeline = await this.db.all<{ at: string }>(
      "SELECT closed_at AS at FROM invoice_state WHERE status = 'closed' AND closed_at IS NOT NULL ORDER BY closed_at",
    );
    return {
      total: counts?.total ?? 0,
      closed: counts?.closed ?? 0,
      posted: counts?.posted ?? 0,
      open: counts?.open ?? 0,
      fresh: counts?.fresh ?? 0,
      remaining: (counts?.total ?? 0) - (counts?.closed ?? 0),
      wrongScans: errs?.wrong ?? 0,
      overScans: errs?.over ?? 0,
      unknownScans: errs?.unknown ?? 0,
      timeline: timeline.map((row) => row.at),
    };
  }

  listInvoices(options: { status?: "all" | "pending" | InvoiceStatus; search?: string; limit?: number } = {}): Promise<InvoiceView[]> {
    return this.enqueue(async () => {
      const where: string[] = [];
      const params: SqlValue[] = [];
      const { status = "all", search = "", limit = 500 } = options;
      if (status === "pending") where.push("status <> 'closed'");
      else if (status !== "all") {
        where.push("status = ?");
        params.push(status);
      }
      const term = normalizeCode(search);
      if (term) {
        where.push("(order_no LIKE ? OR invoices LIKE ?)");
        params.push(`%${term}%`, `%${term}%`);
      }
      const rows = await this.db.all<InvoiceRow>(
        `SELECT * FROM v_invoice_stats ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'posted' THEN 1 WHEN 'new' THEN 2 ELSE 3 END, order_no
         LIMIT ?`,
        [...params, limit],
      );
      return rows.map(toView);
    });
  }

  getInvoice(orderKey: string): Promise<{ invoice: InvoiceView; items: ItemRow[] } | null> {
    return this.enqueue(() => this.readInvoice(orderKey));
  }

  private async readInvoice(orderKey: string) {
    const [row] = await this.db.all<InvoiceRow>("SELECT * FROM v_invoice_stats WHERE order_key = ?", [orderKey]);
    if (!row) return null;
    const items = await this.db.all<ItemRow>(
      `SELECT * FROM v_item_progress WHERE order_key = ?
       ORDER BY seq`,
      [orderKey],
    );
    return { invoice: toView(row), items };
  }

  /** آخر المسحات لفاتورة (للسجل على الشاشة). */
  recentScans(orderKey: string, limit = 8): Promise<Array<{ id: number; code: string; kind: ScanKind; at: string }>> {
    return this.enqueue(() =>
      this.db.all(
        "SELECT id, code, kind, at FROM scans WHERE order_key = ? ORDER BY id DESC LIMIT ?",
        [orderKey, limit],
      ),
    );
  }

  /* ------------------------------ الفاتورة الحالية ----------------------- */

  getCurrent(): Promise<string | null> {
    return this.enqueue(() => this.readCurrent());
  }

  private async readCurrent(): Promise<string | null> {
    const [row] = await this.db.all<{ value: string | null }>("SELECT value FROM app_state WHERE key = 'current_order'");
    const key = row?.value ?? null;
    if (!key) return null;
    const [exists] = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM v_orders WHERE order_key = ?", [key]);
    return (exists?.n ?? 0) > 0 ? key : null;
  }

  private async writeCurrent(key: string | null) {
    await this.db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES ('current_order', ?)", [key]);
  }

  /** فتح فاتورة من القائمة (بدلاً من مسح بوليصتها). */
  openInvoice(orderKey: string): Promise<ScanResult> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession();
        const currentKey = await this.readCurrent();
        const current = currentKey ? await this.readInvoice(currentKey) : null;
        if (current && current.invoice.order_key !== orderKey && isBlocking(current.invoice)) {
          return { type: "blocked" as const, code: orderKey, orderNo: current.invoice.order_no, shortItems: current.invoice.short_items };
        }
        const target = await this.readInvoice(orderKey);
        const staleDay = target ? await this.staleRegistration(target.invoice) : null;
        if (target && staleDay) return { type: "not-today" as const, code: orderKey, orderKey, orderNo: target.invoice.order_no, day: staleDay };
        return this.openOrder(orderKey, current?.invoice ?? null, null);
      }),
    );
  }

  /** إعادة فتح فاتورة منتهية سبق مراجعتها (تُحفظ مسحاتها السابقة). */
  reopenInvoice(orderKey: string): Promise<ScanResult> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession();
        const currentKey = await this.readCurrent();
        const current = currentKey ? await this.readInvoice(currentKey) : null;
        if (current && current.invoice.order_key !== orderKey && isBlocking(current.invoice)) {
          return { type: "blocked" as const, code: orderKey, orderNo: current.invoice.order_no, shortItems: current.invoice.short_items };
        }
        const target = await this.readInvoice(orderKey);
        if (!target) return { type: "order-not-found" as const, code: orderKey };
        if (target.invoice.status !== "closed") return this.openOrder(orderKey, current?.invoice ?? null, null);
        let left: LeftInvoice | undefined;
        if (current && current.invoice.order_key !== orderKey && current.invoice.status === "open") left = await this.releaseInvoice(current.invoice);
        await this.db.run("UPDATE invoice_state SET status = 'open', closed_at = NULL WHERE order_key = ?", [orderKey]);
        await this.writeCurrent(orderKey);
        await this.audit("reopen", target.invoice.order_no, "إعادة فتح فاتورة منتهية");
        return { type: "order-opened" as const, orderKey, orderNo: target.invoice.order_no, readonly: false, resumed: true, left };
      }),
    );
  }

  /** زيادة أو إنقاص كمية صنف ممسوح يدوياً (تصحيح مشكلة في المسح). */
  adjustItem(orderKey: string, itemKey: string, delta: 1 | -1): Promise<{ changed: boolean; scanned: number; qty: number; reason?: string }> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession();
        const invoice = await this.readInvoice(orderKey);
        const item = invoice?.items.find((candidate) => candidate.item_key === itemKey);
        if (!invoice || !item) return { changed: false, scanned: 0, qty: 0, reason: "الصنف غير موجود." };
        if (invoice.invoice.status === "closed") return { changed: false, scanned: item.scanned, qty: item.qty, reason: "الفاتورة منتهية؛ أعد فتحها أولاً." };
        if (delta === 1) {
          const kind = item.scanned + 1 > item.qty ? "over" : "ok";
          await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at, operator) VALUES (?, ?, ?, ?, ?, ?)", [orderKey, itemKey, item.item_code, kind, this.now(), await this.operatorName()]);
          await this.audit("adjust", invoice.invoice.order_no, `+1 ${item.item_code}`);
          return { changed: true, scanned: item.scanned + 1, qty: item.qty };
        }
        const [last] = await this.db.all<{ id: number }>("SELECT id FROM scans WHERE order_key = ? AND item_key = ? AND kind IN ('ok', 'over') ORDER BY id DESC LIMIT 1", [orderKey, itemKey]);
        if (!last) return { changed: false, scanned: item.scanned, qty: item.qty, reason: "لا توجد كمية ممسوحة لإنقاصها." };
        await this.db.run("DELETE FROM scans WHERE id = ?", [last.id]);
        await this.audit("adjust", invoice.invoice.order_no, `-1 ${item.item_code}`);
        return { changed: true, scanned: item.scanned - 1, qty: item.qty };
      }),
    );
  }

  /** الأكواد التي سُجّلت كأخطاء تجهيز على فاتورة (غير موجودة فيها). */
  invoiceErrors(orderKey: string): Promise<Array<{ code: string; count: number; lastAt: string }>> {
    return this.enqueue(() =>
      this.db.all("SELECT code, COUNT(*) AS count, MAX(at) AS lastAt FROM scans WHERE order_key = ? AND kind = 'wrong' GROUP BY code ORDER BY MAX(id) DESC", [orderKey]),
    );
  }

  /* -------------------------------- المسح -------------------------------- */

  handleScan(raw: string): Promise<ScanResult> {
    return this.enqueue(() => this.tx(async () => {
      await this.requireSession();
      return this.processScan(raw);
    }));
  }

  private async findOrder(key: string): Promise<string | null> {
    const [byOrder] = await this.db.all<{ order_key: string }>("SELECT order_key FROM v_orders WHERE order_key = ?", [key]);
    if (byOrder) return byOrder.order_key;
    const [byInvoice] = await this.db.all<{ order_key: string }>("SELECT order_key FROM lines WHERE invoice_key = ? LIMIT 1", [key]);
    return byInvoice?.order_key ?? null;
  }

  /** يوم تسجيل الطلب (آخر استيراد حمله) بالتوقيت المحلي، أو null لبيانات قديمة بلا استيراد. */
  private async registrationDay(orderKey: string): Promise<string | null> {
    const [row] = await this.db.all<{ at: string | null }>(
      "SELECT MAX(i.imported_at) AS at FROM lines l JOIN imports i ON i.id = l.import_id WHERE l.order_key = ?",
      [orderKey],
    );
    return row?.at ? localDay(row.at) : null;
  }

  /** فاتورة جديدة (لم تبدأ) سُجّلت في يوم غير اليوم الحالي => ليست ضمن جدول اليوم. */
  private async staleRegistration(target: InvoiceView): Promise<string | null> {
    if (target.status !== "new") return null;
    const day = await this.registrationDay(target.order_key);
    return day && day !== localDay(this.now()) ? day : null;
  }

  private async processScan(raw: string): Promise<ScanResult> {
    const code = normalizeCode(raw);
    if (!code) return { type: "empty" };
    const key = codeKey(code);
    const at = this.now();
    const operator = await this.operatorName();
    const currentKey = await this.readCurrent();
    const current = currentKey ? await this.readInvoice(currentKey) : null;

    // 1) فاتورة مفتوحة وقابلة للمسح: الكود القصير يُجرَّب كصنف أولاً
    if (current && current.invoice.status !== "closed" && fitsItemCode(code)) {
      const item = current.items.find((candidate) => candidate.item_key === key);
      if (item) {
        const kind = item.scanned + 1 > item.qty ? "over" : "ok";
        await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at, operator) VALUES (?, ?, ?, ?, ?, ?)", [current.invoice.order_key, key, code, kind, at, operator]);
        return { type: "item", kind, code, orderKey: current.invoice.order_key, scanned: item.scanned + 1, qty: item.qty, desc: item.item_desc ?? undefined };
      }
    }

    // 2) فاتورة مغلقة معروضة للقراءة فقط: لا يُقبل مسح أصناف عليها
    if (current && current.invoice.status === "closed" && fitsItemCode(code)) {
      const isItem = current.items.some((candidate) => candidate.item_key === key);
      if (isItem) return { type: "locked", code, orderKey: current.invoice.order_key };
    }

    // 3) هل هو رقم طلب/فاتورة؟ (أي كود أطول من 10 لا يُعد صنفاً، والقصير الذي ليس في الفاتورة يُجرَّب هنا أيضاً)
    const target = await this.findOrder(key);
    if (target && current && current.invoice.order_key === target) return { type: "same-order", orderKey: target };
    if ((target || looksLikeOrderNumber(code)) && current && isBlocking(current.invoice)) {
      return { type: "blocked", code, orderNo: current.invoice.order_no, shortItems: current.invoice.short_items };
    }
    // رقم طلب/فاتورة غير مسجل في الجدول المستورد: يُرفض دائماً (حتى مع وجود فاتورة مفتوحة) ويُسجل كمسح مجهول
    if (!target && looksLikeOrderNumber(code)) {
      await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at, operator) VALUES (NULL, ?, ?, 'unknown', ?, ?)", [key, code, at, operator]);
      return { type: "order-not-found", code };
    }
    if (target) {
      const targetView = await this.readInvoice(target);
      if (targetView?.invoice.status === "closed") return { type: "already-closed", code, orderKey: target, orderNo: targetView.invoice.order_no };
      const staleDay = targetView ? await this.staleRegistration(targetView.invoice) : null;
      if (targetView && staleDay) return { type: "not-today", code, orderKey: target, orderNo: targetView.invoice.order_no, day: staleDay };
      return this.openOrder(target, current?.invoice ?? null, code);
    }

    // 4) غير معروف
    if (current && current.invoice.status !== "closed" && fitsItemCode(code)) {
      // كود صنف غير موجود في الفاتورة => خطأ تجهيز
      await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at, operator) VALUES (?, ?, ?, 'wrong', ?, ?)", [current.invoice.order_key, key, code, at, operator]);
      return { type: "item", kind: "wrong", code, orderKey: current.invoice.order_key };
    }
    await this.db.run("INSERT INTO scans (order_key, item_key, code, kind, at, operator) VALUES (NULL, ?, ?, 'unknown', ?, ?)", [key, code, at, operator]);
    return fitsItemCode(code) ? { type: "no-invoice", code } : { type: "order-not-found", code };
  }

  /** يغادر الفاتورة الحالية (إن كانت مفتوحة) ثم يفتح الهدف. */
  private async openOrder(targetKey: string, leaving: InvoiceView | null, scannedRef: string | null): Promise<ScanResult> {
    const target = await this.readInvoice(targetKey);
    if (!target) return { type: "order-not-found", code: targetKey };
    let left: LeftInvoice | undefined;
    if (leaving && leaving.order_key !== targetKey && leaving.status === "open") {
      left = await this.releaseInvoice(leaving);
    }
    const at = this.now();
    const status = target.invoice.status;
    if (status === "closed") {
      await this.writeCurrent(targetKey);
      return { type: "order-opened", orderKey: targetKey, orderNo: target.invoice.order_no, readonly: true, resumed: false, left };
    }
    await this.db.run(
      "INSERT INTO invoice_state (order_key, status, opened_at, scanned_ref) VALUES (?, 'open', ?, ?) ON CONFLICT(order_key) DO UPDATE SET status = 'open', opened_at = COALESCE(opened_at, excluded.opened_at), scanned_ref = COALESCE(excluded.scanned_ref, scanned_ref)",
      [targetKey, at, scannedRef],
    );
    await this.writeCurrent(targetKey);
    await this.audit("open", target.invoice.order_no, status === "new" ? "بدء مراجعة" : "استئناف");
    return { type: "order-opened", orderKey: targetKey, orderNo: target.invoice.order_no, readonly: false, resumed: status === "posted" || target.invoice.done_qty > 0, left };
  }

  /** عند ترك فاتورة: تُقفل إن اكتملت، وتُرحَّل إن بها نواقص ومسحات، وتعود "جديدة" إن لم يُمسح شيء. */
  private async releaseInvoice(invoice: InvoiceView): Promise<LeftInvoice> {
    const at = this.now();
    const touched = invoice.done_qty > 0 || invoice.wrong_scans > 0 || invoice.over_scans > 0;
    let outcome: LeftInvoice["outcome"];
    if (invoice.short_items === 0) {
      outcome = "closed";
      await this.db.run("UPDATE invoice_state SET status = 'closed', closed_at = ? WHERE order_key = ?", [at, invoice.order_key]);
      await this.queuePrintIfEnabled(invoice.order_key);
    } else if (touched) {
      outcome = "posted";
      await this.db.run("UPDATE invoice_state SET status = 'posted', posted_at = ? WHERE order_key = ?", [at, invoice.order_key]);
    } else {
      outcome = "released";
      await this.db.run("UPDATE invoice_state SET status = 'new', opened_at = NULL WHERE order_key = ?", [invoice.order_key]);
    }
    return { orderKey: invoice.order_key, orderNo: invoice.order_no, outcome, shortItems: invoice.short_items };
  }

  /**
   * إنهاء الفاتورة الحالية:
   * - "close": يلزم ألا توجد نواقص.
   * - "post": ترحيل لاستكمال النواقص (إن لم توجد نواقص تُقفل).
   */
  finishCurrent(mode: "close" | "post"): Promise<{ ok: boolean; outcome?: LeftInvoice["outcome"]; reason?: string; orderNo?: string }> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession();
        const currentKey = await this.readCurrent();
        const current = currentKey ? await this.readInvoice(currentKey) : null;
        if (!current) return { ok: false, reason: "لا توجد فاتورة مفتوحة." };
        if (current.invoice.status === "closed") {
          await this.writeCurrent(null);
          return { ok: true, outcome: "closed" as const, orderNo: current.invoice.order_no };
        }
        if (mode === "close" && current.invoice.short_items > 0) {
          return { ok: false, reason: "توجد أصناف لم تكتمل؛ استخدم «ترحيل لاستكمال النواقص».", orderNo: current.invoice.order_no };
        }
        const left = await this.releaseInvoice(current.invoice);
        // الترحيل الصريح لا يعيد الفاتورة "جديدة" حتى لو لم يُمسح شيء
        let outcome = left.outcome;
        if (outcome === "released" && mode === "post") {
          await this.db.run("UPDATE invoice_state SET status = 'posted', posted_at = ? WHERE order_key = ?", [this.now(), current.invoice.order_key]);
          outcome = "posted";
        }
        await this.writeCurrent(null);
        await this.audit(outcome === "closed" ? "close" : outcome === "posted" ? "post" : "release", current.invoice.order_no, `ناقص ${current.invoice.short_items} صنف`);
        return { ok: true, outcome, orderNo: current.invoice.order_no };
      }),
    );
  }

  /** إلغاء آخر مسحة على الفاتورة (مسح خاطئ بالخطأ). */
  undoLastScan(orderKey: string): Promise<{ removed: boolean; code?: string }> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession();
        const [last] = await this.db.all<{ id: number; code: string }>("SELECT id, code FROM scans WHERE order_key = ? ORDER BY id DESC LIMIT 1", [orderKey]);
        if (!last) return { removed: false };
        await this.db.run("DELETE FROM scans WHERE id = ?", [last.id]);
        await this.audit("undo", orderKey, `إلغاء مسحة ${last.code}`);
        return { removed: true, code: last.code };
      }),
    );
  }

  /* -------------------------------- التقرير ------------------------------ */

  errorReport(): Promise<ErrorReport> {
    return this.enqueue(async () => {
      const grouped = await this.db.all<{
        kind: "wrong" | "over";
        order_no: string | null;
        invoices: string | null;
        code: string;
        n: number;
        first_at: string;
        qty: number | null;
        scanned: number | null;
        operator: string | null;
      }>(
        `SELECT s.kind AS kind, o.order_no AS order_no, o.invoices AS invoices, s.code AS code,
                COUNT(*) AS n, MIN(s.at) AS first_at, p.qty AS qty, p.scanned AS scanned, MIN(s.operator) AS operator
         FROM scans s
         LEFT JOIN v_orders o ON o.order_key = s.order_key
         LEFT JOIN v_item_progress p ON p.order_key = s.order_key AND p.item_key = s.item_key
         WHERE s.kind IN ('wrong', 'over')
         GROUP BY s.kind, s.order_key, s.item_key, s.code
         ORDER BY first_at`,
      );
      const toRow = (row: (typeof grouped)[number]): ErrorReportRow => ({
        kind: row.kind,
        orderNo: row.order_no ?? "",
        invoices: row.invoices ?? "",
        code: row.code,
        count: row.n,
        firstAt: row.first_at,
        expected: row.kind === "over" ? row.qty : null,
        scanned: row.kind === "over" ? row.scanned : null,
        operator: row.operator ?? "",
      });
      const shortages = await this.db.all<{ order_no: string; invoices: string | null; item_code: string; unit: string | null; qty: number; scanned: number }>(
        `SELECT o.order_no, o.invoices, p.item_code, p.unit, p.qty, p.scanned
         FROM v_item_progress p
         JOIN v_orders o ON o.order_key = p.order_key
         JOIN invoice_state st ON st.order_key = p.order_key AND st.status = 'posted'
         WHERE p.scanned < p.qty
         ORDER BY o.order_no, p.item_code`,
      );
      const unknown = await this.db.all<{ code: string; at: string }>("SELECT code, at FROM scans WHERE kind = 'unknown' ORDER BY at");
      const stats = await this.readStats();
      return {
        generatedAt: this.now(),
        stats,
        wrong: grouped.filter((row) => row.kind === "wrong").map(toRow),
        over: grouped.filter((row) => row.kind === "over").map(toRow),
        shortages: shortages.map((row) => ({ orderNo: row.order_no, invoices: row.invoices ?? "", code: row.item_code, unit: row.unit ?? "", expected: row.qty, scanned: row.scanned })),
        unknown,
        kpis: await this.readKpis(),
        printLog: await this.readPrintLog(),
      };
    });
  }


  /* ------------------------------- الإعدادات ----------------------------- */

  private async readSetting(key: string): Promise<string | null> {
    const [row] = await this.db.all<{ value: string | null }>("SELECT value FROM app_state WHERE key = ?", [`setting:${key}`]);
    const value = row?.value ?? null;
    return value === null || value === "" ? null : value;
  }

  getSetting(key: string): Promise<string | null> {
    return this.enqueue(() => this.readSetting(key));
  }

  setSetting(key: string, value: string | null): Promise<void> {
    return this.enqueue(async () => {
      if (!/^(sync:|backup:|operator$)/.test(key)) await this.audit("setting", key, value ? String(value).slice(0, 80) : "(مسح)");
      await this.db.run("INSERT OR REPLACE INTO app_state (key, value) VALUES (?, ?)", [`setting:${key}`, value]);
    });
  }

  getPrintConfig(): Promise<PrintConfig> {
    return this.enqueue(() => this.readPrintConfig());
  }

  private async readPrintConfig(): Promise<PrintConfig> {
    const enabled = await this.readSetting("print_enabled");
    return {
      enabled: enabled !== "0",
      folder: await this.readSetting("pdf_folder"),
      invoicePrinter: await this.readSetting("printer_invoice"),
      labelPrinter: await this.readSetting("printer_label"),
      operator: await this.operatorName(),
    };
  }

  /* -------------------------- فهرس ملفات PDF والطباعة -------------------- */

  replacePrintIndex(entries: PrintFileEntry[]): Promise<{ invoices: number; labels: number }> {
    return this.enqueue(() =>
      this.tx(async () => {
        // الفهرسة من مجلد SAF تستبدل روابط content:// فقط وتُبقي الملفات المنسوخة من Drive/OneDrive (file://)
        await this.db.run("DELETE FROM print_files WHERE uri LIKE 'content:%'");
        for (let start = 0; start < entries.length; start += 100) {
          const chunk = entries.slice(start, start + 100);
          const params: SqlValue[] = [];
          for (const e of chunk) params.push(e.refKey, e.kind, e.name, e.uri);
          await this.db.run(`INSERT OR REPLACE INTO print_files (ref_key, kind, name, uri) VALUES ${chunk.map(() => "(?,?,?,?)").join(",")}`, params);
        }
        const rows = await this.db.all<{ kind: PrintKind; n: number }>("SELECT kind, COUNT(*) AS n FROM print_files GROUP BY kind");
        return { invoices: rows.find((r) => r.kind === "invoice")?.n ?? 0, labels: rows.find((r) => r.kind === "label")?.n ?? 0 };
      }),
    );
  }

  /** يضيف/يحدّث ملفات PDF (منسوخة من Drive/OneDrive أو الجهاز) دون مسح الفهرس الحالي. */
  mergePrintIndex(entries: PrintFileEntry[]): Promise<{ invoices: number; labels: number }> {
    return this.enqueue(() =>
      this.tx(async () => {
        for (let start = 0; start < entries.length; start += 100) {
          const chunk = entries.slice(start, start + 100);
          const params: SqlValue[] = [];
          for (const e of chunk) params.push(e.refKey, e.kind, e.name, e.uri);
          await this.db.run(`INSERT OR REPLACE INTO print_files (ref_key, kind, name, uri) VALUES ${chunk.map(() => "(?,?,?,?)").join(",")}`, params);
        }
        const rows = await this.db.all<{ kind: PrintKind; n: number }>("SELECT kind, COUNT(*) AS n FROM print_files GROUP BY kind");
        return { invoices: rows.find((r) => r.kind === "invoice")?.n ?? 0, labels: rows.find((r) => r.kind === "label")?.n ?? 0 };
      }),
    );
  }

  clearPrintIndex(): Promise<void> {
    return this.enqueue(async () => {
      await this.db.run("DELETE FROM print_files");
    });
  }

  printIndexCounts(): Promise<{ invoices: number; labels: number }> {
    return this.enqueue(async () => {
      const rows = await this.db.all<{ kind: PrintKind; n: number }>("SELECT kind, COUNT(*) AS n FROM print_files GROUP BY kind");
      return { invoices: rows.find((r) => r.kind === "invoice")?.n ?? 0, labels: rows.find((r) => r.kind === "label")?.n ?? 0 };
    });
  }

  /** يبحث عن ملف بالمراجع بالترتيب (الرقم الممسوح أولاً) مع تجاهل الأصفار البادئة وحالة الحروف. */
  findPrintFile(refs: string[], kind: PrintKind): Promise<{ ref: string; name: string; uri: string } | null> {
    return this.enqueue(async () => {
      for (const ref of refs) {
        if (!ref) continue;
        const [row] = await this.db.all<{ name: string; uri: string }>("SELECT name, uri FROM print_files WHERE ref_key = ? AND kind = ?", [codeKey(ref), kind]);
        if (row) return { ref, name: row.name, uri: row.uri };
      }
      return null;
    });
  }

  private async queuePrintIfEnabled(orderKey: string) {
    const cfg = await this.readPrintConfig();
    if (!cfg.enabled || !cfg.folder) return;
    await this.insertPrintJobs(orderKey, false);
  }

  private async insertPrintJobs(orderKey: string, force: boolean) {
    const at = this.now();
    for (const kind of ["invoice", "label"] as PrintKind[]) {
      await this.db.run(
        `INSERT OR ${force ? "REPLACE" : "IGNORE"} INTO print_jobs (order_key, kind, status, detail, file_name, attempts, created_at, updated_at) VALUES (?, ?, 'pending', NULL, NULL, 0, ?, ?)`,
        [orderKey, kind, at, at],
      );
    }
  }

  /** إعادة طباعة يدوية لفاتورة منتهية (تعمل حتى لو كانت الطباعة التلقائية معطلة). */
  requeuePrint(orderKey: string): Promise<void> {
    return this.enqueue(() => this.tx(() => this.insertPrintJobs(orderKey, true)));
  }

  /** يأخذ أقدم مهمة منتظرة ويعلّمها «جارية». */
  nextPrintJob(): Promise<PrintJob | null> {
    return this.enqueue(() =>
      this.tx(async () => {
        const [row] = await this.db.all<{ order_key: string; kind: PrintKind; attempts: number; order_no: string; invoices: string | null; scanned_ref: string | null }>(
          `SELECT j.order_key, j.kind, j.attempts, o.order_no, o.invoices, st.scanned_ref
           FROM print_jobs j
           JOIN v_orders o ON o.order_key = j.order_key
           LEFT JOIN invoice_state st ON st.order_key = j.order_key
           WHERE j.status = 'pending'
           ORDER BY j.created_at, CASE j.kind WHEN 'invoice' THEN 0 ELSE 1 END
           LIMIT 1`,
        );
        if (!row) return null;
        await this.db.run("UPDATE print_jobs SET status = 'printing', attempts = attempts + 1, updated_at = ? WHERE order_key = ? AND kind = ?", [this.now(), row.order_key, row.kind]);
        const refs: string[] = [];
        for (const ref of [row.scanned_ref ?? "", row.order_no, ...(row.invoices ?? "").split(",")]) {
          const clean = ref.trim();
          if (clean && !refs.some((r) => codeKey(r) === codeKey(clean))) refs.push(clean);
        }
        return { orderKey: row.order_key, kind: row.kind, attempts: row.attempts + 1, refs };
      }),
    );
  }

  finishPrintJob(orderKey: string, kind: PrintKind, status: PrintStatus, detail: string | null, fileName: string | null): Promise<void> {
    return this.enqueue(async () => {
      await this.db.run("UPDATE print_jobs SET status = ?, detail = ?, file_name = ?, updated_at = ? WHERE order_key = ? AND kind = ?", [status, detail, fileName, this.now(), orderKey, kind]);
    });
  }

  /** يعيد مهام الطباعة الفاشلة/المفقودة إلى الانتظار. */
  retryPrints(): Promise<number> {
    return this.enqueue(async () => {
      const result = await this.db.run("UPDATE print_jobs SET status = 'pending', detail = NULL, updated_at = ? WHERE status IN ('failed', 'missing')", [this.now()]);
      return result.changes;
    });
  }

  /**
   * إعادة محاولة تلقائية بتأخير متزايد: الفاشلة (خطأ شبكة/طابعة) 1، 2، 4… دقيقة حتى 10،
   * والمفقودة (ملف PDF لم يصل بعد) كل 3 دقائق؛ حتى PRINT_MAX_ATTEMPTS محاولات.
   */
  autoRetryPrints(nowMs: number = Date.parse(this.now())): Promise<number> {
    return this.enqueue(async () => {
      const rows = await this.db.all<{ order_key: string; kind: PrintKind; status: PrintStatus; attempts: number; updated_at: string }>(
        "SELECT order_key, kind, status, attempts, updated_at FROM print_jobs WHERE status IN ('failed', 'missing') AND attempts < ?",
        [PRINT_MAX_ATTEMPTS],
      );
      let count = 0;
      for (const row of rows) {
        const waitMin = row.status === "missing" ? 3 : Math.min(10, 2 ** Math.max(0, row.attempts - 1));
        if (nowMs - Date.parse(row.updated_at) < waitMin * 60_000) continue;
        await this.db.run("UPDATE print_jobs SET status = 'pending', updated_at = ? WHERE order_key = ? AND kind = ?", [this.now(), row.order_key, row.kind]);
        count += 1;
      }
      return count;
    });
  }

  /** مهام الطباعة التي تحتاج تدخلاً (فاشلة أو ملف مفقود) مع التفاصيل. */
  async printProblems(): Promise<PrintLogRow[]> {
    return (await this.printLog()).filter((row) => row.status === "failed" || row.status === "missing");
  }

  /** إنتاجية المشغّلين منذ تاريخ معيّن (ISO) أو كل الفترة. للمشرف فقط. */
  operatorStats(sinceIso: string | null): Promise<OperatorStat[]> {
    return this.enqueue(async () => {
      await this.requireSession("supervisor");
      const since = sinceIso ?? "0000";
      const rows = await this.db.all<{ operator: string; ok: number; over: number; wrong: number; active_s: number; first_at: string; last_at: string }>(
        `WITH s AS (
           SELECT operator, at, kind,
                  (julianday(at) - julianday(LAG(at) OVER (PARTITION BY operator ORDER BY at, id))) * 86400.0 AS gap
           FROM scans
           WHERE operator IS NOT NULL AND operator <> '' AND kind IN ('ok', 'over', 'wrong') AND at >= ?
         )
         SELECT operator,
                COALESCE(SUM(kind = 'ok'), 0) AS ok, COALESCE(SUM(kind = 'over'), 0) AS over, COALESCE(SUM(kind = 'wrong'), 0) AS wrong,
                COALESCE(SUM(CASE WHEN gap IS NOT NULL AND gap <= 120 THEN gap ELSE 0 END), 0) AS active_s,
                MIN(at) AS first_at, MAX(at) AS last_at
         FROM s GROUP BY operator ORDER BY (COALESCE(SUM(kind = 'ok'), 0) + COALESCE(SUM(kind = 'over'), 0)) DESC`,
        [since],
      );
      const events = await this.db.all<{ operator: string; event: string; n: number }>(
        "SELECT operator, event, COUNT(*) AS n FROM audit_log WHERE event IN ('close', 'post') AND operator IS NOT NULL AND at >= ? GROUP BY operator, event",
        [since],
      );
      return rows.map((r) => ({
        operator: r.operator,
        ok: r.ok,
        over: r.over,
        wrong: r.wrong,
        activeSeconds: Math.round(r.active_s),
        closed: events.find((e) => e.operator === r.operator && e.event === "close")?.n ?? 0,
        posted: events.find((e) => e.operator === r.operator && e.event === "post")?.n ?? 0,
        firstAt: r.first_at,
        lastAt: r.last_at,
      }));
    });
  }

  printSummary(): Promise<PrintSummary> {
    return this.enqueue(async () => {
      const rows = await this.db.all<{ status: PrintStatus; n: number }>("SELECT status, COUNT(*) AS n FROM print_jobs GROUP BY status");
      const summary: PrintSummary = { pending: 0, printing: 0, done: 0, failed: 0, missing: 0 };
      for (const row of rows) summary[row.status] = row.n;
      return summary;
    });
  }

  printLog(): Promise<PrintLogRow[]> {
    return this.enqueue(() => this.readPrintLog());
  }

  private async readPrintLog(): Promise<PrintLogRow[]> {
    const rows = await this.db.all<{ order_no: string; invoices: string | null; kind: PrintKind; status: PrintStatus; detail: string | null; file_name: string | null; updated_at: string }>(
      `SELECT o.order_no, o.invoices, j.kind, j.status, j.detail, j.file_name, j.updated_at
       FROM print_jobs j JOIN v_orders o ON o.order_key = j.order_key
       ORDER BY j.updated_at DESC, j.kind LIMIT 400`,
    );
    return rows.map((r) => ({ orderNo: r.order_no, invoices: r.invoices ?? "", kind: r.kind, status: r.status, detail: r.detail ?? "", fileName: r.file_name ?? "", updatedAt: r.updated_at }));
  }

  /* ------------------------------ مؤشرات الأداء --------------------------- */

  getKpis(): Promise<Kpis> {
    return this.enqueue(() => this.readKpis());
  }

  private async readKpis(): Promise<Kpis> {
    const [units] = await this.db.all<{ ok: number; over: number; wrong: number }>(
      `SELECT COALESCE(SUM(kind = 'ok'), 0) AS ok, COALESCE(SUM(kind = 'over'), 0) AS over, COALESCE(SUM(kind = 'wrong'), 0) AS wrong FROM scans`,
    );
    const ok = units?.ok ?? 0;
    const over = units?.over ?? 0;
    const wrong = units?.wrong ?? 0;
    const acceptedUnits = ok + over;
    const totalScans = ok + over + wrong;

    const [closed] = await this.db.all<{ closed: number; clean: number; cycle: number | null }>(
      `SELECT COUNT(*) AS closed,
              COALESCE(SUM(CASE WHEN v.wrong_scans = 0 AND v.over_scans = 0 THEN 1 ELSE 0 END), 0) AS clean,
              AVG(CASE WHEN v.opened_at IS NOT NULL AND v.closed_at IS NOT NULL THEN (julianday(v.closed_at) - julianday(v.opened_at)) * 86400.0 END) AS cycle
       FROM v_invoice_stats v WHERE v.status = 'closed'`,
    );
    // ساعات العمل الفعلي: مجموع الفجوات بين المسحات المتتالية بحد أقصى دقيقتين للفجوة الواحدة
    const [active] = await this.db.all<{ seconds: number | null }>(
      `SELECT SUM(MIN(gap, 120.0)) AS seconds FROM (
         SELECT (julianday(at) - julianday(LAG(at) OVER (ORDER BY id))) * 86400.0 AS gap
         FROM scans WHERE kind IN ('ok', 'over', 'wrong')
       ) WHERE gap IS NOT NULL`,
    );
    const activeHours = (active?.seconds ?? 0) / 3600;
    const [remaining] = await this.db.all<{ units: number | null }>("SELECT SUM(total_qty - done_qty) AS units FROM v_invoice_stats WHERE status <> 'closed'");
    const remainingUnits = Math.max(0, remaining?.units ?? 0);
    const unitsPerHour = activeHours > 0 && acceptedUnits > 0 ? acceptedUnits / activeHours : null;
    const closedCount = closed?.closed ?? 0;
    const pareto = await this.db.all<{ code: string; kind: "wrong" | "over"; count: number }>(
      "SELECT code, kind, COUNT(*) AS count FROM scans WHERE kind IN ('wrong', 'over') GROUP BY code, kind ORDER BY count DESC, code LIMIT 5",
    );
    const [posted] = await this.db.all<{ at: string | null }>("SELECT MIN(posted_at) AS at FROM invoice_state WHERE status = 'posted'");
    return {
      acceptedUnits,
      accuracy: totalScans > 0 ? Math.round((ok / totalScans) * 1000) / 10 : null,
      firstPassYield: closedCount > 0 ? Math.round(((closed?.clean ?? 0) / closedCount) * 1000) / 10 : null,
      avgCycleSeconds: closed?.cycle ?? null,
      activeHours,
      unitsPerHour,
      invoicesPerHour: activeHours > 0 && closedCount > 0 ? closedCount / activeHours : null,
      remainingUnits,
      etaMinutes: unitsPerHour ? Math.round((remainingUnits / unitsPerHour) * 60) : null,
      pareto,
      oldestPostedAt: posted?.at ?? null,
    };
  }

  /* ------------------- المشغّلون والتدقيق والنسخ الاحتياطي ------------------- */

  private session: Session | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly failures = new Map<string, { count: number; until: number }>();

  subscribeSession(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getSession(): Session | null {
    return this.session;
  }

  private setSession(next: Session | null) {
    this.session = next;
    this.listeners.forEach((listener) => listener());
  }

  private async operatorName(): Promise<string | null> {
    return this.session?.name ?? (await this.readSetting("operator"));
  }

  private async countOperators(): Promise<number> {
    const [row] = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM operators WHERE active = 1");
    return row?.n ?? 0;
  }

  /** عند وجود مشغّلين: لا عملية بلا تسجيل دخول؛ وبعضها للمشرف فقط. (بلا مشغّلين = وضع قديم بلا قيود.) */
  private async requireSession(role?: Role): Promise<void> {
    if ((await this.countOperators()) === 0) return;
    if (!this.session) throw new Error("سجّل الدخول أولاً.");
    if (role === "supervisor" && this.session.role !== "supervisor") throw new Error("هذه العملية للمشرف فقط.");
  }

  private async audit(event: string, ref: string | null = null, detail: string | null = null, operator?: string | null): Promise<void> {
    await this.db.run("INSERT INTO audit_log (at, operator, event, ref, detail) VALUES (?, ?, ?, ?, ?)", [
      this.now(),
      operator === undefined ? this.session?.name ?? (await this.readSetting("operator")) : operator,
      event,
      ref,
      detail,
    ]);
  }

  /** سجل حدث من خارج المحرك (مثل نسخ احتياطي ناجح أو فاشل). */
  recordEvent(event: string, ref: string | null, detail: string | null): Promise<void> {
    return this.enqueue(() => this.audit(event, ref, detail));
  }

  /** أسماء المشغّلين النشطين لشاشة الدخول (بلا أي بيانات سرية). */
  loginNames(): Promise<string[]> {
    return this.enqueue(async () => (await this.db.all<{ name: string }>("SELECT name FROM operators WHERE active = 1 ORDER BY name")).map((r) => r.name));
  }

  needsSetup(): Promise<boolean> {
    return this.enqueue(async () => (await this.countOperators()) === 0);
  }

  async hasOperators(): Promise<boolean> {
    return !(await this.needsSetup());
  }

  createOperator(name: string, pin: string, role: Role = "operator"): Promise<Session> {
    return this.enqueue(() =>
      this.tx(async () => {
        const clean = name.trim();
        if (clean.length < 2) throw new Error("اسم المشغّل قصير جداً.");
        if (!/^\d{4,8}$/.test(pin)) throw new Error("رمز PIN من 4 إلى 8 أرقام.");
        const first = (await this.countOperators()) === 0;
        if (!first) await this.requireSession("supervisor");
        const [dup] = await this.db.all<{ id: number }>("SELECT id FROM operators WHERE name = ?", [clean]);
        if (dup) throw new Error("يوجد مشغّل بهذا الاسم.");
        const salt = randomSalt();
        const finalRole: Role = first ? "supervisor" : role;
        const res = await this.db.run("INSERT INTO operators (name, salt, pin_hash, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)", [clean, salt, hashPin(pin, salt), finalRole, this.now()]);
        const created: Session = { id: res.lastId, name: clean, role: finalRole };
        await this.audit(first ? "setup" : "operator_add", clean, finalRole, first ? clean : undefined);
        if (first) this.setSession(created);
        return created;
      }),
    );
  }

  login(name: string, pin: string): Promise<{ ok: true; session: Session } | { ok: false; reason: string }> {
    return this.enqueue(async () => {
      const key = name.trim().toLowerCase();
      const fail = this.failures.get(key);
      if (fail && fail.until > Date.now()) {
        return { ok: false as const, reason: `محاولات كثيرة خاطئة. انتظر ${Math.ceil((fail.until - Date.now()) / 1000)} ثانية.` };
      }
      const [row] = await this.db.all<{ id: number; name: string; salt: string; pin_hash: string; role: Role; active: number }>(
        "SELECT * FROM operators WHERE name = ? COLLATE NOCASE",
        [name.trim()],
      );
      if (!row || !row.active || hashPin(pin, row.salt) !== row.pin_hash) {
        const count = (fail?.count ?? 0) + 1;
        this.failures.set(key, { count, until: count >= 5 ? Date.now() + 60_000 : 0 });
        await this.audit("login_failed", name.trim(), `محاولة ${count}`, name.trim());
        return { ok: false as const, reason: count >= 5 ? "تم القفل لمدة دقيقة بعد 5 محاولات خاطئة." : "الاسم أو الرمز غير صحيح." };
      }
      this.failures.delete(key);
      const session: Session = { id: row.id, name: row.name, role: row.role };
      this.setSession(session);
      await this.audit("login", row.name, row.role);
      return { ok: true as const, session };
    });
  }

  logout(): Promise<void> {
    return this.enqueue(async () => {
      if (this.session) await this.audit("logout", this.session.name);
      this.setSession(null);
    });
  }

  listOperators(): Promise<OperatorRow[]> {
    return this.enqueue(async () => {
      await this.requireSession("supervisor");
      return this.db.all<OperatorRow>("SELECT id, name, role, active FROM operators ORDER BY id");
    });
  }

  setOperatorActive(id: number, active: boolean): Promise<void> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession("supervisor");
        const [target] = await this.db.all<OperatorRow>("SELECT id, name, role, active FROM operators WHERE id = ?", [id]);
        if (!target) throw new Error("المشغّل غير موجود.");
        if (!active) {
          if (this.session?.id === id) throw new Error("لا يمكنك تعطيل حسابك الحالي.");
          if (target.role === "supervisor") {
            const [others] = await this.db.all<{ n: number }>("SELECT COUNT(*) AS n FROM operators WHERE role = 'supervisor' AND active = 1 AND id <> ?", [id]);
            if (!others || others.n === 0) throw new Error("يجب بقاء مشرف واحد نشط على الأقل.");
          }
        }
        await this.db.run("UPDATE operators SET active = ? WHERE id = ?", [active ? 1 : 0, id]);
        await this.audit(active ? "operator_enable" : "operator_disable", target.name);
      }),
    );
  }

  resetPin(id: number, pin: string): Promise<void> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession("supervisor");
        if (!/^\d{4,8}$/.test(pin)) throw new Error("رمز PIN من 4 إلى 8 أرقام.");
        const [target] = await this.db.all<OperatorRow>("SELECT id, name, role, active FROM operators WHERE id = ?", [id]);
        if (!target) throw new Error("المشغّل غير موجود.");
        const salt = randomSalt();
        await this.db.run("UPDATE operators SET salt = ?, pin_hash = ? WHERE id = ?", [salt, hashPin(pin, salt), id]);
        await this.audit("pin_reset", target.name);
      }),
    );
  }

  auditLog(limit = 200): Promise<AuditRow[]> {
    return this.enqueue(async () => {
      await this.requireSession("supervisor");
      return this.db.all<AuditRow>("SELECT id, at, operator, event, ref, detail FROM audit_log ORDER BY id DESC LIMIT ?", [limit]);
    });
  }

  /** لقطة كاملة لبيانات التدقيق (لا تتضمن حسابات المشغّلين ولا رموزهم). */
  exportSnapshot(): Promise<Snapshot> {
    return this.enqueue(async () => {
      await this.requireSession();
      const tables: Snapshot["tables"] = {};
      for (const name of SNAPSHOT_TABLES) {
        const rows = await this.db.all<Record<string, SqlValue>>(`SELECT * FROM ${name}`);
        const columns = rows.length > 0 ? Object.keys(rows[0]) : (await this.db.all<{ name: string }>(`PRAGMA table_info(${name})`)).map((c) => c.name);
        tables[name] = { columns, rows: rows.map((row) => columns.map((c) => row[c] ?? null)) };
      }
      return { app: "marsood", format: 1, createdAt: this.now(), tables };
    });
  }

  /** يستبدل بيانات التدقيق بلقطة سابقة (للمشرف). سجل التدقيق وحسابات المشغّلين لا تُمس. */
  restoreSnapshot(snapshot: Snapshot): Promise<{ tables: number; rows: number }> {
    return this.enqueue(() =>
      this.tx(async () => {
        await this.requireSession("supervisor");
        if (snapshot?.app !== "marsood" || snapshot.format !== 1 || typeof snapshot.tables !== "object") throw new Error("الملف ليس نسخة احتياطية صالحة لمِرصاد.");
        for (const name of SNAPSHOT_TABLES) {
          const t = snapshot.tables[name];
          if (!t || !Array.isArray(t.columns) || !Array.isArray(t.rows)) throw new Error(`النسخة ناقصة: الجدول ${name} غير موجود.`);
          if (!t.columns.every((c) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(c))) throw new Error("أسماء أعمدة غير صالحة في النسخة.");
        }
        let rowsTotal = 0;
        for (const name of SNAPSHOT_TABLES) {
          await this.db.run(`DELETE FROM ${name}`);
          const { columns, rows } = snapshot.tables[name];
          if (rows.length === 0) continue;
          const marks = `(${columns.map(() => "?").join(",")})`;
          const per = Math.max(1, Math.floor(900 / columns.length));
          for (let i = 0; i < rows.length; i += per) {
            const chunk = rows.slice(i, i + per);
            await this.db.run(`INSERT INTO ${name} (${columns.join(",")}) VALUES ${chunk.map(() => marks).join(",")}`, chunk.flat() as SqlValue[]);
          }
          rowsTotal += rows.length;
        }
        await this.audit("restore", snapshot.createdAt, `${rowsTotal} صف`);
        return { tables: SNAPSHOT_TABLES.length, rows: rowsTotal };
      }),
    );
  }
}
