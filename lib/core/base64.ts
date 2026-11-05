const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const LOOKUP = new Map<string, number>(Array.from(ALPHABET, (char, index) => [char, index] as [string, number]));

/** يفك ترميز Base64 إلى بايتات دون الاعتماد على atob (غير مضمون في كل بيئات التشغيل). */
export function base64ToBytes(input: string): Uint8Array {
  const clean = input.replace(/[^A-Za-z0-9+/]/g, "");
  const total = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(total);
  let written = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = LOOKUP.get(clean[i]) ?? 0;
    const b = LOOKUP.get(clean[i + 1] ?? "A") ?? 0;
    const c = LOOKUP.get(clean[i + 2] ?? "A") ?? 0;
    const d = LOOKUP.get(clean[i + 3] ?? "A") ?? 0;
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (written < total) out[written++] = (chunk >> 16) & 0xff;
    if (written < total) out[written++] = (chunk >> 8) & 0xff;
    if (written < total) out[written++] = chunk & 0xff;
  }
  return out;
}
