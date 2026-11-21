/**
 * محرك التعبئة الديناميكي (PackagingEngine).
 *
 * - الوحدة الأساسية للحساب هي «الحبة» (EH = PCS = 1)، والدرزن DZ = 12 حبة، ونصف الدرزن HDZ = 6 حبات.
 * - كل الحسابات بأعداد صحيحة (حبات) أو بأعداد عشرية مضروبة في 10000 → لا أخطاء تقريب عائمة.
 * - القواعد تُعرَّف بمدى باركود (من–إلى) مع حجم كرتون وعدد علب قابلين للتغيير.
 * - لا قسمة على صفر: كل دالة ترفض المعاملات غير الصالحة صراحةً.
 */

export type Unit = "EH" | "PCS" | "DZ" | "HDZ";
export const UNITS: readonly Unit[] = ["EH", "PCS", "DZ", "HDZ"];
export type ExtendedUnit = Unit | "BOX" | "CARTON";

/** عدد الحبات في كل وحدة ثابتة. */
export const UNIT_PIECES: Record<Unit, number> = { EH: 1, PCS: 1, DZ: 12, HDZ: 6 };

/** المدى المسموح به للعبوة (قابل للتعديل من الواجهة بحدود آمنة). */
export const LIMITS = { cartonPiecesMin: 12, cartonPiecesMax: 72, boxesMin: 1, boxesMax: 12 } as const;

/** دقة الكسور العشرية عند الصرف بالدرزن (4 أرقام). */
export const DECIMALS = 4;
const SCALE = 10 ** DECIMALS;

export class PackagingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PackagingError";
  }
}

export interface PackRule {
  id: string;
  name: string;
  /** باركود البداية والنهاية (شاملان). */
  from: number;
  to: number;
  /** إجمالي الحبات في الكرتون (12–72). */
  cartonPieces: number;
  /** عدد العلب في الكرتون. */
  boxesPerCarton: number;
  /** وحدة صرف الطلبات (تقرير الانتقاء). */
  issueUnit: Unit;
  /** الوحدة الرئيسية للنظام (الاستلام والجرد). */
  mainUnit: Unit;
  enabled: boolean;
}

export interface PackScope {
  from: number;
  to: number;
}

export interface Composite {
  cartons: number;
  boxes: number;
  pieces: number;
}

const isInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n);

/** عدد الحبات في العلبة الواحدة (يُرفض غير الصحيح). */
export function piecesPerBox(rule: Pick<PackRule, "cartonPieces" | "boxesPerCarton">): number {
  if (!isInt(rule.cartonPieces) || !isInt(rule.boxesPerCarton) || rule.boxesPerCarton <= 0 || rule.cartonPieces <= 0) {
    throw new PackagingError("عبوة غير صالحة");
  }
  if (rule.cartonPieces % rule.boxesPerCarton !== 0) throw new PackagingError("حبات الكرتون لا تقبل القسمة على عدد العلب");
  return rule.cartonPieces / rule.boxesPerCarton;
}

/** تحقق من قاعدة؛ يعيد قائمة أخطاء فارغة إذا كانت صالحة. */
export function validateRule(rule: PackRule): string[] {
  const errors: string[] = [];
  if (!isInt(rule.from) || !isInt(rule.to) || rule.from <= 0 || rule.to <= 0) errors.push("الباركود يجب أن يكون رقماً صحيحاً موجباً");
  else if (rule.from > rule.to) errors.push("باركود البداية أكبر من النهاية");
  if (!isInt(rule.cartonPieces) || rule.cartonPieces < LIMITS.cartonPiecesMin || rule.cartonPieces > LIMITS.cartonPiecesMax) {
    errors.push(`حبات الكرتون يجب أن تكون بين ${LIMITS.cartonPiecesMin} و${LIMITS.cartonPiecesMax}`);
  }
  if (!isInt(rule.boxesPerCarton) || rule.boxesPerCarton < LIMITS.boxesMin || rule.boxesPerCarton > LIMITS.boxesMax) {
    errors.push(`عدد العلب يجب أن يكون بين ${LIMITS.boxesMin} و${LIMITS.boxesMax}`);
  } else if (isInt(rule.cartonPieces) && rule.cartonPieces % rule.boxesPerCarton !== 0) {
    errors.push("حبات الكرتون لا تقبل القسمة على عدد العلب");
  }
  if (!UNITS.includes(rule.issueUnit)) errors.push("وحدة الصرف غير معروفة");
  if (!UNITS.includes(rule.mainUnit)) errors.push("الوحدة الرئيسية غير معروفة");
  return errors;
}

/** المدى المتداخل بين قاعدتين مفعّلتين (يُبلَّغ عنه ولا يُمنع؛ الأضيق مدىً يفوز). */
export function findOverlaps(rules: PackRule[]): Array<[PackRule, PackRule]> {
  const active = rules.filter((r) => r.enabled && validateRule(r).length === 0).sort((a, b) => a.from - b.from);
  const out: Array<[PackRule, PackRule]> = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length && active[j].from <= active[i].to; j++) out.push([active[i], active[j]]);
  }
  return out;
}

/** تحويل رمز الصنف إلى عدد صحيح، أو null إذا لم يكن رقمياً. */
export function barcodeNumber(code: string | number): number | null {
  const text = String(code).replace(/[‎‏​\s]/g, "");
  if (!/^\d{1,15}$/.test(text)) return null;
  return Number(text);
}

/** القاعدة المطابقة لباركود: الأضيق مدىً ثم الأحدث ترتيباً؛ ضمن نطاق التنفيذ إن وُجد. */
export function findRule(code: string | number, rules: PackRule[], scope?: PackScope | null): PackRule | null {
  const n = barcodeNumber(code);
  if (n === null) return null;
  if (scope && (n < scope.from || n > scope.to)) return null;
  let best: PackRule | null = null;
  for (const r of rules) {
    if (!r.enabled || n < r.from || n > r.to || validateRule(r).length) continue;
    if (!best || r.to - r.from <= best.to - best.from) best = r;
  }
  return best;
}

/** عدد الحبات في وحدة، وفق القاعدة للعلبة والكرتون. */
export function unitPieces(unit: ExtendedUnit, rule?: PackRule | null): number {
  if (unit === "BOX") {
    if (!rule) throw new PackagingError("وحدة العلبة تحتاج قاعدة عبوة");
    return piecesPerBox(rule);
  }
  if (unit === "CARTON") {
    if (!rule) throw new PackagingError("وحدة الكرتون تحتاج قاعدة عبوة");
    piecesPerBox(rule);
    return rule.cartonPieces;
  }
  const factor = UNIT_PIECES[unit];
  if (!factor) throw new PackagingError(`وحدة غير معروفة: ${String(unit)}`);
  return factor;
}

/** تحويل رقم (أو نص عشري) إلى عدد صحيح مضروب في 10000 دون استخدام الفاصلة العائمة. */
export function toScaled(value: number | string): number {
  const text = String(value).trim().replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(",", ".").replace(/٫/g, ".");
  if (!/^-?\d+(\.\d+)?$/.test(text)) {
    // أرقام بصيغة علمية (مثل 1e-7) تأتي من الأعداد العائمة؛ نعالجها عبر toFixed
    const n = typeof value === "number" ? value : Number(text);
    if (!Number.isFinite(n)) throw new PackagingError("كمية غير صالحة");
    return toScaled(n.toFixed(DECIMALS + 2));
  }
  const negative = text.startsWith("-");
  const [intPart, frac = ""] = text.replace("-", "").split(".");
  const padded = (frac + "000000").slice(0, DECIMALS + 2);
  const head = Number(intPart) * SCALE + Number(padded.slice(0, DECIMALS));
  const tail = Number(padded.slice(DECIMALS)); // خانتان زائدتان للتقريب
  const rounded = head + (tail >= 50 ? 1 : 0);
  return negative ? -rounded : rounded;
}

/** كمية بوحدة معيّنة → إجمالي الحبات (تقريب لأقرب حبة؛ يعيد أيضاً هل كانت الكمية صحيحة). */
export function toPieces(qty: number | string, unit: ExtendedUnit, rule?: PackRule | null): { pieces: number; exact: boolean } {
  const factor = unitPieces(unit, rule);
  const scaled = toScaled(qty);
  const numerator = scaled * factor;
  const pieces = Math.sign(numerator) * Math.floor((Math.abs(numerator) + SCALE / 2) / SCALE);
  return { pieces, exact: numerator % SCALE === 0 };
}

/** إجمالي الحبات → كمية بوحدة معيّنة، مقرّبة إلى 4 أرقام عشرية (نصف لأعلى). */
export function fromPieces(pieces: number, unit: ExtendedUnit, rule?: PackRule | null): number {
  if (!isInt(pieces)) throw new PackagingError("عدد الحبات يجب أن يكون صحيحاً");
  const factor = unitPieces(unit, rule);
  const scaled = Math.sign(pieces) * Math.floor((Math.abs(pieces) * SCALE + factor / 2) / factor);
  return scaled / SCALE;
}

/** تحويل مباشر بين وحدتين. */
export function convert(qty: number | string, from: ExtendedUnit, to: ExtendedUnit, rule?: PackRule | null): number {
  return fromPieces(toPieces(qty, from, rule).pieces, to, rule);
}

/** تفكيك إجمالي الحبات إلى كرتون + علبة + حبة. */
export function breakdown(pieces: number, rule: PackRule): Composite {
  if (!isInt(pieces) || pieces < 0) throw new PackagingError("عدد الحبات يجب أن يكون صحيحاً غير سالب");
  const perBox = piecesPerBox(rule);
  const cartons = Math.floor(pieces / rule.cartonPieces);
  const rest = pieces - cartons * rule.cartonPieces;
  const boxes = Math.floor(rest / perBox);
  return { cartons, boxes, pieces: rest - boxes * perBox };
}

/** تجميع كرتون + علبة + حبة إلى إجمالي الحبات. */
export function compose(parts: Partial<Composite>, rule: PackRule): number {
  const { cartons = 0, boxes = 0, pieces = 0 } = parts;
  if (![cartons, boxes, pieces].every((n) => isInt(n) && n >= 0)) throw new PackagingError("الكميات المركبة أعداد صحيحة غير سالبة");
  return cartons * rule.cartonPieces + boxes * piecesPerBox(rule) + pieces;
}

/** وصف عربي مختصر: «3 كرتون + 5 علبة + 2 حبة». */
export function describeComposite(c: Composite): string {
  const parts: string[] = [];
  if (c.cartons) parts.push(`${c.cartons} كرتون`);
  if (c.boxes) parts.push(`${c.boxes} علبة`);
  if (c.pieces || !parts.length) parts.push(`${c.pieces} حبة`);
  return parts.join(" + ");
}

export interface Resolved {
  rule: PackRule;
  /** الكمية كما في الفاتورة (بوحدة الصرف). */
  pieces: number;
  exact: boolean;
  composite: Composite;
  /** الكمية بالوحدة الرئيسية (مقرّبة 4 أرقام). */
  inMain: number;
  label: string;
}

/** كمية سطر فاتورة بوحدته (إن لم تُذكر وحدة تُعتبر وحدة صرف القاعدة) → تفاصيل التعبئة. */
export function resolveLine(code: string | number, qty: number | string, unit: string | null | undefined, rules: PackRule[], scope?: PackScope | null): Resolved | null {
  const rule = findRule(code, rules, scope);
  if (!rule) return null;
  const upper = String(unit ?? "").trim().toUpperCase();
  const alias: Record<string, Unit> = { EA: "EH", EH: "EH", PC: "PCS", PCS: "PCS", DZ: "DZ", DOZ: "DZ", HDZ: "HDZ" };
  const u: Unit = alias[upper] ?? rule.issueUnit;
  const { pieces, exact } = toPieces(qty, u, rule);
  if (pieces < 0) return null;
  const composite = breakdown(pieces, rule);
  return { rule, pieces, exact, composite, inMain: fromPieces(pieces, rule.mainUnit, rule), label: describeComposite(composite) };
}

/** عدد الحبات الذي يقابل مسحة واحدة لباركود علبة (وحدة الصرف) ضمن القاعدة. */
export function scanStep(rule: PackRule): number {
  return unitPieces(rule.issueUnit, rule);
}

/** تعيين وحدة رئيسية على كل القواعد داخل نطاق التنفيذ (الخطوة الثانية في الإعداد). */
export function applyMainUnit(rules: PackRule[], scope: PackScope, mainUnit: Unit): PackRule[] {
  if (!UNITS.includes(mainUnit)) throw new PackagingError("وحدة رئيسية غير معروفة");
  return rules.map((r) => (r.from <= scope.to && r.to >= scope.from ? { ...r, mainUnit } : r));
}

/** القواعد التي يتقاطع مداها مع نطاق التنفيذ. */
export function rulesInScope(rules: PackRule[], scope: PackScope): PackRule[] {
  if (!isInt(scope.from) || !isInt(scope.to) || scope.from > scope.to) throw new PackagingError("نطاق التنفيذ غير صالح");
  return rules.filter((r) => r.from <= scope.to && r.to >= scope.from);
}

/** تحليل JSON محفوظ بأمان؛ يتجاهل القواعد غير الصالحة. */
export function parseRules(json: string | null): PackRule[] {
  if (!json) return [];
  try {
    const data = JSON.parse(json) as unknown;
    if (!Array.isArray(data)) return [];
    return data.filter((r): r is PackRule => !!r && typeof r === "object" && validateRule(r as PackRule).length === 0);
  } catch {
    return [];
  }
}

/** القواعد الافتراضية المستخرجة من جدول الشروط المعتمد. */
export function defaultRules(): PackRule[] {
  const mk = (id: string, name: string, from: number, to: number, cartonPieces: number, boxesPerCarton: number, issueUnit: Unit, mainUnit: Unit): PackRule => ({
    id, name, from, to, cartonPieces, boxesPerCarton, issueUnit, mainUnit, enabled: true,
  });
  return [
    mk("under-drosh", "ملابس داخلية دروش", 114110001, 115412004, 72, 12, "HDZ", "DZ"),
    mk("under-drosh-v", "ملابس داخلية دروش V", 184000571, 184100017, 72, 12, "HDZ", "DZ"),
    mk("under-pioneer", "ملابس داخلية بايونير", 130110001, 138412003, 72, 12, "HDZ", "DZ"),
    mk("pj-fleece", "بيجاما فرو وحرارى", 116100551, 116190191, 12, 2, "DZ", "DZ"),
    mk("shemagh", "شماغ وغتر", 511107155, 740103760, 20, 4, "PCS", "PCS"),
    mk("thobe-summer", "ثوب رسمي صيفى", 361100706, 371230207, 12, 4, "PCS", "PCS"),
    mk("thobe-home", "ثوب منزلى", 910371598, 910371695, 24, 2, "EH", "EH"),
    mk("thobe-color", "ثوب رسمي ملون", 910375602, 910376554, 12, 2, "PCS", "PCS"),
    mk("thobe-winter", "ثوب رسمي شتوى", 910376690, 910378505, 12, 3, "PCS", "PCS"),
    mk("pj-regular", "بيجاما عادية", 910378516, 910378632, 24, 4, "EH", "EH"),
  ];
}

/** القواعد المخزّنة، أو الافتراضية إذا لم تُحفظ قواعد بعد. */
export function loadRules(json: string | null): PackRule[] {
  return json === null ? defaultRules() : parseRules(json);
}

/** نطاق التنفيذ المخزّن (JSON {from,to}) أو null. */
export function parseScope(json: string | null): PackScope | null {
  if (!json) return null;
  try {
    const s = JSON.parse(json) as PackScope;
    return isInt(s.from) && isInt(s.to) && s.from > 0 && s.from <= s.to ? { from: s.from, to: s.to } : null;
  } catch {
    return null;
  }
}
