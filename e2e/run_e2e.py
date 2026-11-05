"""اختبار شامل على محاكي أندرويد: استيراد Excel عبر منتقي الملفات، ثم مسح بإدخال لوحة مفاتيح (يحاكي قارئ HID)."""
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ET

PKG = "space.manus.marsood.t173502143869505"
failures = []


def adb(*args, check=False):
    return subprocess.run(["adb", *args], capture_output=True, text=True, check=check).stdout


def dump(retries=6):
    for _ in range(retries):
        out = adb("shell", "uiautomator", "dump", "/sdcard/ui.xml")
        if "dumped" in out.lower():
            adb("pull", "/sdcard/ui.xml", "/tmp/ui.xml")
            try:
                return ET.parse("/tmp/ui.xml").getroot()
            except ET.ParseError:
                pass
        time.sleep(1)
    return None


def labels(root):
    out = []
    if root is None:
        return out
    for n in root.iter("node"):
        for key in ("text", "content-desc"):
            v = n.attrib.get(key, "").strip()
            if v:
                out.append(v)
    return out


def center(bounds):
    x1, y1, x2, y2 = map(int, re.findall(r"\d+", bounds))
    return (x1 + x2) // 2, (y1 + y2) // 2


def find(root, needle, exact=False):
    if root is None:
        return None
    best = None
    for n in root.iter("node"):
        for key in ("text", "content-desc"):
            v = n.attrib.get(key, "").strip()
            if v and ((v == needle) if exact else (needle in v)):
                if best is None:
                    best = n
    return best


def swipe(up=True):
    adb("shell", "input", "swipe", "600", "1100" if up else "400", "600", "400" if up else "1100", "300")
    time.sleep(0.8)


def wait_for(needle, timeout=40, exact=False):
    """يبحث عن النص ويمرّر الشاشة لأسفل عند اللزوم (الأزرار قد تكون خارج الشاشة)."""
    end = time.time() + timeout
    root = None
    rounds = 0
    while time.time() < end:
        root = dump()
        node = find(root, needle, exact)
        if node is not None:
            return node
        rounds += 1
        if rounds % 8 == 4:
            for _ in range(3):
                swipe(up=True)
        elif rounds % 8 == 0:
            for _ in range(5):
                swipe(up=False)
        time.sleep(1.0)
    print(f"--- لم يظهر «{needle}»؛ العناصر الظاهرة:", flush=True)
    for l in labels(root)[:60]:
        print("   ", l)
    return None


def tap(node):
    x, y = center(node.attrib["bounds"])
    adb("shell", "input", "tap", str(x), str(y))


def tap_text(needle, timeout=40, exact=False):
    node = wait_for(needle, timeout, exact)
    if node is None:
        return False
    tap(node)
    return True


def tap_tab(name, expect, attempts=4):
    """يضغط زر تبويب سفلي ويتأكد من ظهور محتوى الشاشة المقصودة، مع إعادة المحاولة وطباعة التشخيص."""
    for attempt in range(attempts):
        root = dump()
        target = None
        if root is not None:
            for n in root.iter("node"):
                desc = n.attrib.get("content-desc", "")
                if desc.endswith(", " + name):
                    target = n
                    break
        print(f"--- تبويب «{name}» محاولة {attempt}: عقدة={'نعم ' + target.attrib.get('bounds', '') + ' clickable=' + target.attrib.get('clickable', '') if target is not None else 'لا'}", flush=True)
        if target is not None:
            # أعلى الزر بدل منتصفه: في المحاكي اللوحي يغطي شريط المهام الجزء السفلي من الشاشة
            x1, y1, x2, y2 = map(int, re.findall(r"\d+", target.attrib["bounds"]))
            adb("shell", "input", "tap", str((x1 + x2) // 2), str(y1 + max(8, (y2 - y1) // 6)))
        time.sleep(2.5)
        after = dump()
        print("    بعد الضغط:", labels(after)[:6], flush=True)
        if find(after, expect) is not None:
            return True
    return False


def check(name, ok, extra=""):
    print(("PASS  " if ok else "FAIL  ") + name + (f"  [{extra}]" if extra else ""), flush=True)
    if not ok:
        failures.append(name)


def scan(code, terminator="enter", wait=1.2):
    """يحاكي قارئ HID: يكتب الأحرف كلوحة مفاتيح ثم Enter (66) أو Tab (61) أو لا شيء."""
    adb("shell", "input", "text", code)
    if terminator == "enter":
        adb("shell", "input", "keyevent", "66")
    elif terminator == "tab":
        adb("shell", "input", "keyevent", "61")
    time.sleep(wait)


def main():
    print("wm size:", adb("shell", "wm", "size").strip(), "| density:", adb("shell", "wm", "density").strip(), flush=True)
    adb("shell", "pm", "grant", PKG, "android.permission.READ_EXTERNAL_STORAGE")
    adb("shell", "am", "start", "-n", f"{PKG}/.MainActivity")
    node = wait_for("مِرصاد المستودع", 90)
    check("التطبيق يفتح ولوحة العمل تظهر (قاعدة SQLite تعمل)", node is not None)
    if node is None:
        return

    # ---------- الاستيراد ----------
    check("زر الاستيراد ظاهر", tap_text("استيراد ملف Excel", 20))
    check("شاشة الاستيراد", wait_for("اختر ملف الفواتير", 20) is not None)
    tap_text("تحديد ملف من الجهاز", 20)
    time.sleep(3)
    picked = False
    for attempt in range(6):
        root = dump()
        print(f"--- منتقي الملفات (محاولة {attempt}):", labels(root)[:40], flush=True)
        n = find(root, "marsood-sample.xlsx")
        if n is not None:
            tap(n)
            picked = True
            break
        # افتح قائمة الجذور ثم Downloads
        d = find(root, "Show roots") or find(root, "Open navigation") or find(root, "Show root")
        dl = find(root, "Downloads", exact=True)
        if dl is not None:
            tap(dl)
        elif d is not None:
            tap(d)
        time.sleep(2)
    check("اختيار الملف من منتقي أندرويد", picked)
    ok = wait_for("سطر صالح", 40) is not None
    check("قراءة ملف Excel وعرض المعاينة (3 طلبات / 5 أسطر صالحة)", ok)
    if not ok:
        return
    root = dump()
    check("عُرفت العناوين العربية تلقائياً (لا اقتراح ترتيب افتراضي)", find(root, "عُرفت الأعمدة من العناوين") is not None)
    check("أُبلغ عن الصفوف المعيبة بدل إسقاطها بصمت", find(root, "أسطر مستبعدة") is not None)
    tap_text("استيراد 5 سطر", 30)
    check("تم الاستيراد", wait_for("تم الاستيراد", 30) is not None)
    tap_text("بدء المسح", 20)

    # ---------- المسح بقارئ HID ----------
    time.sleep(2)
    check("شاشة المسح", wait_for("امسح رقم الطلب", 20) is not None)
    scan("5550001112223")  # Enter
    check("مسح البوليصة (Enter) يفتح الفاتورة", wait_for("فُتح الطلب 5550001112223", 15) is not None)
    scan("1001")
    check("مسح صنف صحيح", wait_for("تم مسح 1001", 15) is not None)
    scan("9999", "tab")
    check("كود غير موجود (Tab) = خطأ تجهيز", wait_for("خطأ تجهيز", 15) is not None)
    scan("1001", "none", wait=2.5)  # بلا منهٍ: يُعتمد بعد توقف القراءة
    check("اعتماد القراءة بعد توقفها (بلا Enter)", wait_for("الممسوح 2 من 2", 15) is not None)
    scan("1001")
    check("مسح أكثر من الكمية = تجهيز زائد", wait_for("تجهيز زائد", 15) is not None)
    scan("12345678901")  # أطول من 10 خانات ولا يطابق طلباً
    check("كود أطول من 10 خانات ليس صنفاً", wait_for("رقم الطلب غير موجود", 15) is not None)
    scan("1002")
    root = dump()
    check("الفاتورة اكتملت 100%", find(root, "100%") is not None)
    tap_text("إنهاء الفاتورة", 15)
    check("إقفال الفاتورة", wait_for("أُنهيت الفاتورة", 15) is not None)
    scan("5550001112224")
    check("فتح فاتورة ثانية", wait_for("فُتح الطلب 5550001112224", 15) is not None)
    scan("2001")
    tap_text("ترحيل لاستكمال النواقص", 15)
    check("ترحيل بنواقص", wait_for("رُحِّلت الفاتورة", 15) is not None)

    # ---------- لوحة العمل والتقرير ----------
    tap_tab("لوحة العمل", "مراجعة فواتير التجهيز")
    root_ok = wait_for("تقدم المراجعة", 20)
    check("لوحة العمل تعرض التقدم", root_ok is not None)
    tap_tab("التقرير", "تقرير الأخطاء")
    check("شاشة التقرير تعرض أخطاء التجهيز", wait_for("أخطاء التجهيز", 20) is not None)
    root = dump()
    check("التقرير يسرد الكود الخاطئ 9999", find(root, "9999") is not None)


try:
    main()
finally:
    print("\nlogcat (أخطاء التطبيق):", flush=True)
    log = adb("logcat", "-d", "-s", "ReactNativeJS:E", "AndroidRuntime:E")
    print(log[-3000:])
    print("\nالنتيجة:", "نجحت كل الفحوص" if not failures else f"فشل {len(failures)}: {failures}")
    sys.exit(1 if failures else 0)
