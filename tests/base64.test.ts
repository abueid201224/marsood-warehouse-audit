import { describe, expect, it } from "vitest";
import { base64ToBytes } from "../lib/core/base64";

describe("base64ToBytes", () => {
  const enc = (s: string) => Buffer.from(s).toString("base64");
  it("يفك ترميزاً بأطوال مختلفة (مع الحشو وبدونه)", () => {
    for (const text of ["", "a", "ab", "abc", "abcd", "Marsood-مرصاد"]) {
      expect(Array.from(base64ToBytes(enc(text)))).toEqual(Array.from(Buffer.from(text)));
    }
  });
  it("يتجاهل فواصل الأسطر", () => {
    const b64 = enc("hello world, this is a long enough string").replace(/(.{10})/g, "$1\n");
    expect(Buffer.from(base64ToBytes(b64)).toString()).toBe("hello world, this is a long enough string");
  });
});
