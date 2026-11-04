export type LineState = "matched" | "short" | "over";
export type SessionState = "ready" | "in-progress" | "review" | "complete";
export type ExceptionKind = "unknown-barcode" | "ambiguous-barcode" | "overage" | "import";
export type ExceptionState = "open" | "resolved";
export type AuditEventKind = "scan" | "unknown-scan" | "manual-adjustment";

export interface AuditItem {
  id: string;
  barcode: string;
  description: string;
  expectedQty: number;
  scannedQty: number;
  sourceRow: number;
  unit?: string;
}

export interface AuditException {
  id: string;
  kind: ExceptionKind;
  state: ExceptionState;
  barcode: string;
  itemId?: string;
  message: string;
  createdAt: string;
  resolutionNote?: string;
  resolvedAt?: string;
}

export interface AuditEvent {
  id: string;
  kind: AuditEventKind;
  barcode: string;
  itemId?: string;
  at: string;
  delta?: number;
  note?: string;
}

export interface AuditSession {
  id: string;
  invoiceNumber: string;
  sourceFileName: string;
  sourceUri?: string;
  createdAt: string;
  updatedAt: string;
  state: SessionState;
  items: AuditItem[];
  exceptions: AuditException[];
  events: AuditEvent[];
}

export interface SessionSummary {
  lineCount: number;
  matchedLines: number;
  shortLines: number;
  overLines: number;
  expectedUnits: number;
  scannedUnits: number;
  openExceptions: number;
}

export type ScanOutcome =
  | { kind: "empty" }
  | { kind: "unknown"; session: AuditSession; exception: AuditException }
  | { kind: "ambiguous"; session: AuditSession; exception: AuditException; candidates: AuditItem[] }
  | { kind: "recorded"; session: AuditSession; item: AuditItem; overage: boolean };

export function normalizeBarcode(input: string): string {
  const arabicDigits = "٠١٢٣٤٥٦٧٨٩";
  const persianDigits = "۰۱۲۳۴۵۶۷۸۹";
  return input
    .trim()
    .replace(/[٠-٩]/g, (char) => String(arabicDigits.indexOf(char)))
    .replace(/[۰-۹]/g, (char) => String(persianDigits.indexOf(char)))
    .replace(/[\s\u200e\u200f\u202a-\u202e]/g, "")
    .toUpperCase();
}

export function getLineState(item: Pick<AuditItem, "expectedQty" | "scannedQty">): LineState {
  if (item.scannedQty === item.expectedQty) return "matched";
  return item.scannedQty > item.expectedQty ? "over" : "short";
}

export function getSessionSummary(session: AuditSession): SessionSummary {
  const matchedLines = session.items.filter((item) => getLineState(item) === "matched").length;
  const shortLines = session.items.filter((item) => getLineState(item) === "short").length;
  const overLines = session.items.filter((item) => getLineState(item) === "over").length;
  return {
    lineCount: session.items.length,
    matchedLines,
    shortLines,
    overLines,
    expectedUnits: session.items.reduce((sum, item) => sum + item.expectedQty, 0),
    scannedUnits: session.items.reduce((sum, item) => sum + item.scannedQty, 0),
    openExceptions: session.exceptions.filter((item) => item.state === "open").length,
  };
}

export function canCompleteSession(session: AuditSession): boolean {
  const summary = getSessionSummary(session);
  return (
    session.items.length > 0 &&
    summary.openExceptions === 0 &&
    summary.matchedLines === session.items.length
  );
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function withUpdated(session: AuditSession, patch: Partial<AuditSession>, at: string): AuditSession {
  return { ...session, ...patch, updatedAt: at };
}

function recordForItem(
  session: AuditSession,
  itemId: string,
  barcode: string,
  at: string,
): ScanOutcome {
  const itemIndex = session.items.findIndex((candidate) => candidate.id === itemId);
  if (itemIndex < 0) return { kind: "empty" };
  const nextItem = { ...session.items[itemIndex], scannedQty: session.items[itemIndex].scannedQty + 1 };
  const items = session.items.map((candidate, index) => (index === itemIndex ? nextItem : candidate));
  const events = [
    ...session.events,
    { id: makeId("event"), kind: "scan" as const, barcode, itemId, at, delta: 1 },
  ];
  const overage = nextItem.scannedQty > nextItem.expectedQty;
  let exceptions = session.exceptions;
  if (
    overage &&
    !exceptions.some(
      (exception) => exception.kind === "overage" && exception.itemId === itemId && exception.state === "open",
    )
  ) {
    exceptions = [
      ...exceptions,
      {
        id: makeId("exception"),
        kind: "overage",
        state: "open",
        barcode,
        itemId,
        message: `تم تجاوز الكمية المتوقعة للصنف ${nextItem.description || barcode}`,
        createdAt: at,
      },
    ];
  }
  const updated = withUpdated(
    session,
    { items, events, exceptions, state: exceptions.some((entry) => entry.state === "open") ? "review" : "in-progress" },
    at,
  );
  return { kind: "recorded", session: updated, item: nextItem, overage };
}

export function applyBarcodeScan(
  session: AuditSession,
  rawBarcode: string,
  at = new Date().toISOString(),
): ScanOutcome {
  const barcode = normalizeBarcode(rawBarcode);
  if (!barcode) return { kind: "empty" };
  const matches = session.items.filter((item) => normalizeBarcode(item.barcode) === barcode);
  if (matches.length === 1) return recordForItem(session, matches[0].id, barcode, at);

  if (matches.length > 1) {
    const exception: AuditException = {
      id: makeId("exception"),
      kind: "ambiguous-barcode",
      state: "open",
      barcode,
      message: `الباركود موجود في ${matches.length} أسطر؛ اختر السطر الصحيح يدوياً.`,
      createdAt: at,
    };
    const updated = withUpdated(
      session,
      { exceptions: [...session.exceptions, exception], state: "review" },
      at,
    );
    return { kind: "ambiguous", session: updated, exception, candidates: matches };
  }

  const exception: AuditException = {
    id: makeId("exception"),
    kind: "unknown-barcode",
    state: "open",
    barcode,
    message: `الباركود ${barcode} غير موجود في الفاتورة.`,
    createdAt: at,
  };
  const updated = withUpdated(
    session,
    {
      exceptions: [...session.exceptions, exception],
      events: [...session.events, { id: makeId("event"), kind: "unknown-scan", barcode, at }],
      state: "review",
    },
    at,
  );
  return { kind: "unknown", session: updated, exception };
}

export function resolveAmbiguousScan(
  session: AuditSession,
  exceptionId: string,
  itemId: string,
  at = new Date().toISOString(),
): AuditSession {
  const target = session.exceptions.find(
    (entry) => entry.id === exceptionId && entry.kind === "ambiguous-barcode" && entry.state === "open",
  );
  if (!target) return session;
  const outcome = recordForItem(session, itemId, target.barcode, at);
  if (outcome.kind !== "recorded") return session;
  const exceptions = outcome.session.exceptions.map((entry) =>
    entry.id === exceptionId
      ? { ...entry, state: "resolved" as const, resolutionNote: "اختيار السطر الصحيح", resolvedAt: at }
      : entry,
  );
  return withUpdated(outcome.session, { exceptions }, at);
}

export function resolveException(
  session: AuditSession,
  exceptionId: string,
  note: string,
  at = new Date().toISOString(),
): AuditSession {
  const resolutionNote = note.trim();
  if (!resolutionNote) return session;
  const exists = session.exceptions.some(
    (entry) => entry.id === exceptionId && entry.state === "open" && entry.kind !== "ambiguous-barcode",
  );
  if (!exists) return session;
  const exceptions = session.exceptions.map((entry) =>
    entry.id === exceptionId
      ? { ...entry, state: "resolved" as const, resolutionNote, resolvedAt: at }
      : entry,
  );
  const state = exceptions.some((entry) => entry.state === "open") ? "review" : "in-progress";
  return withUpdated(session, { exceptions, state }, at);
}

export function adjustScannedQuantity(
  session: AuditSession,
  itemId: string,
  quantity: number,
  reason: string,
  at = new Date().toISOString(),
): { session?: AuditSession; error?: string } {
  if (!Number.isFinite(quantity) || quantity < 0) return { error: "أدخل كمية رقمية غير سالبة." };
  if (!reason.trim()) return { error: "اكتب سبب التعديل لحفظه في سجل المراجعة." };
  const item = session.items.find((candidate) => candidate.id === itemId);
  if (!item) return { error: "تعذر العثور على بند الفاتورة." };
  const items = session.items.map((candidate) =>
    candidate.id === itemId ? { ...candidate, scannedQty: quantity } : candidate,
  );
  const delta = quantity - item.scannedQty;
  const events = [
    ...session.events,
    {
      id: makeId("event"),
      kind: "manual-adjustment" as const,
      barcode: item.barcode,
      itemId,
      at,
      delta,
      note: reason.trim(),
    },
  ];
  let exceptions = session.exceptions;
  if (
    quantity > item.expectedQty &&
    !exceptions.some(
      (exception) => exception.kind === "overage" && exception.itemId === itemId && exception.state === "open",
    )
  ) {
    exceptions = [
      ...exceptions,
      {
        id: makeId("exception"),
        kind: "overage",
        state: "open",
        barcode: item.barcode,
        itemId,
        message: `الكمية المعدلة تتجاوز المتوقع للصنف ${item.description || item.barcode}`,
        createdAt: at,
      },
    ];
  }
  return {
    session: withUpdated(
      session,
      { items, events, exceptions, state: "review" },
      at,
    ),
  };
}

export function completeSession(session: AuditSession, at = new Date().toISOString()): AuditSession {
  if (!canCompleteSession(session)) return session;
  return withUpdated(session, { state: "complete" }, at);
}

export function createAuditSession(
  invoiceNumber: string,
  sourceFileName: string,
  rows: Array<{ barcode: string; description: string; expectedQty: number; sourceRow: number }>,
  at = new Date().toISOString(),
): AuditSession {
  const id = makeId("session");
  const items = rows.map((row, index) => ({
    id: `${id}-line-${index + 1}`,
    barcode: normalizeBarcode(row.barcode),
    description: row.description.trim(),
    expectedQty: row.expectedQty,
    scannedQty: 0,
    sourceRow: row.sourceRow,
  }));
  return {
    id,
    invoiceNumber: invoiceNumber.trim() || sourceFileName.replace(/\.[^.]+$/, ""),
    sourceFileName,
    createdAt: at,
    updatedAt: at,
    state: "ready",
    items,
    exceptions: [],
    events: [],
  };
}
