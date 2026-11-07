"""اختبار شامل على محاكي أندرويد: استيراد Excel عبر منتقي الملفات، ثم مسح بإدخال لوحة مفاتيح (يحاكي قارئ HID)."""
import re
import subprocess
import sys
import threading
import time
import xml.etree.ElementTree as ET
from http.server import BaseHTTPRequestHandler, HTTPServer
import struct

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


# ---------------- طابعة IPP وهمية على المضيف (المحاكي يصلها عبر 10.0.2.2) ----------------
QUERIES = []
PRINTS = []  # (path, document_bytes)


def parse_ipp(body):
    """يحلل رسالة IPP ويعيد (رمز العملية، رقم الطلب، طول بيانات المستند)."""
    code = struct.unpack(">H", body[2:4])[0]
    rid = struct.unpack(">I", body[4:8])[0]
    pos = 8
    while pos < len(body):
        tag = body[pos]
        pos += 1
        if tag == 0x03:
            return code, rid, body[pos:]
        if tag <= 0x05:
            continue
        nlen = struct.unpack(">H", body[pos:pos + 2])[0]
        pos += 2 + nlen
        vlen = struct.unpack(">H", body[pos:pos + 2])[0]
        pos += 2 + vlen
    return code, rid, b""


def ipp_reply(rid, job_id=None):
    out = b"\x01\x01" + struct.pack(">H", 0) + struct.pack(">I", rid)
    out += b"\x01" + b"\x47" + struct.pack(">H", 18) + b"attributes-charset" + struct.pack(">H", 5) + b"utf-8"
    if job_id is not None:
        out += b"\x02" + b"\x21" + struct.pack(">H", 6) + b"job-id" + struct.pack(">H", 4) + struct.pack(">I", job_id)
    else:
        out += b"\x04" + b"\x42" + struct.pack(">H", 12) + b"printer-name" + struct.pack(">H", 4) + b"Mock"
        out += b"\x49" + struct.pack(">H", 25) + b"document-format-supported" + struct.pack(">H", 15) + b"application/pdf"
        out += b"\x23" + struct.pack(">H", 13) + b"printer-state" + struct.pack(">H", 4) + struct.pack(">I", 3)
    return out + b"\x03"


class IppHandler(BaseHTTPRequestHandler):
    def do_POST(self):
        body = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        code, rid, doc = parse_ipp(body)
        if code == 2:
            PRINTS.append((self.path, doc))
            reply = ipp_reply(rid, len(PRINTS))
        else:
            QUERIES.append(self.path)
            reply = ipp_reply(rid)
        self.send_response(200)
        self.send_header("Content-Type", "application/ipp")
        self.send_header("Content-Length", str(len(reply)))
        self.end_headers()
        self.wfile.write(reply)

    def log_message(self, *args):
        pass


def start_printer():
    server = HTTPServer(("0.0.0.0", 8631), IppHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def ime_shown():
    return "mInputShown=true" in adb("shell", "dumpsys", "input_method")


def hide_keyboard():
    if ime_shown():
        adb("shell", "input", "keyevent", "4")
        time.sleep(1)


def edit_texts():
    root = dump()
    nodes = [n for n in (root.iter("node") if root is not None else []) if n.attrib.get("class") == "android.widget.EditText"]
    return sorted(nodes, key=lambda n: int(re.findall(r"\d+", n.attrib["bounds"])[1]))


def fill_edit(hint, value):
    node = wait_for(hint, 25, exact=True)
    if node is None:
        return False
    tap(node)
    time.sleep(0.8)
    adb("shell", "input", "text", value)
    time.sleep(0.5)
    hide_keyboard()
    return True


def find_ci(root, needle):
    if root is None:
        return None
    low = needle.lower()
    for n in root.iter("node"):
        for key in ("text", "content-desc"):
            if low in n.attrib.get(key, "").lower() and n.attrib.get(key, "").strip():
                return n
    return None


def pick_pdf_folder():
    """يتنقل في منتقي المجلدات حتى Documents/marsood-pdfs ثم يمنح الصلاحية."""
    time.sleep(3)
    for attempt in range(14):
        root = dump()
        print(f"--- منتقي المجلد (محاولة {attempt}):", labels(root)[:30], flush=True)
        use = find_ci(root, "use this folder")
        title = labels(root)[:6]
        if use is not None and any("marsood-pdfs" in t for t in title):
            for tries in range(4):
                print("--- زر «Use this folder»:", use.attrib.get("bounds"), "clickable=", use.attrib.get("clickable"), flush=True)
                x1, y1, x2, y2 = map(int, re.findall(r"\d+", use.attrib["bounds"]))
                adb("shell", "input", "tap", str((x1 + x2) // 2), str(min(y2 - 4, y1 + max(8, (y2 - y1) // 3))))
                time.sleep(2.5)
                after = dump()
                print("    بعد الضغط:", labels(after)[:12], flush=True)
                allow = None
                for n in (after.iter("node") if after is not None else []):
                    if n.attrib.get("text", "").strip().upper() == "ALLOW":
                        allow = n
                if allow is not None:
                    tap(allow)
                    time.sleep(2)
                    return True
                use = find_ci(after, "use this folder")
                if use is None:
                    return True
            return False
        n = find(root, "marsood-pdfs")
        if n is not None:
            tap(n)
        elif find(root, "Documents", exact=True) is not None:
            tap(find(root, "Documents", exact=True))
        else:
            roots = find(root, "Show roots") or find(root, "Show root") or find(root, "Open navigation")
            drawer_item = find_ci(root, "Android SDK") or find_ci(root, "Internal storage") or find_ci(root, "sdk_gphone")
            if drawer_item is not None:
                tap(drawer_item)
            elif roots is not None:
                tap(roots)
        time.sleep(2)
    return False


def count_prints(path_suffix):
    return sum(1 for p, _ in PRINTS if p.endswith(path_suffix))


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
    check("عُرفت العناوين العربية تلقائياً (لا اقتراح ترتيب افتراضي)", wait_for("عُرفت الأعمدة من العناوين", 15) is not None)
    check("أُبلغ عن الصفوف المعيبة بدل إسقاطها بصمت", wait_for("أسطر مستبعدة", 25) is not None)
    tap_text("استيراد 5 سطر", 30)
    check("تم الاستيراد", wait_for("تم الاستيراد", 30) is not None)
    tap_text("بدء المسح", 20)

    # ---------- إعداد الطباعة الصامتة ----------
    start_printer()
    tap_tab("الإعدادات", "الطباعة التلقائية")
    check("شاشة الإعدادات", wait_for("قاعدة بيانات الفواتير", 20) is not None)
    tap_text("اختيار المجلد وتهيئة الفهرس", 20)
    check("اختيار مجلد PDF عبر منتقي أندرويد", pick_pdf_folder())
    check("فهرسة ملفات الفاتورة والبوليصة", wait_for("تمت تهيئة قاعدة بيانات الفواتير", 30) is not None)
    check("عدد المفهرس صحيح (2 فاتورة و1 بوليصة)", wait_for("عُثر على 2 فاتورة", 10) is not None)
    check("إدخال عنوان طابعة الفواتير", fill_edit("192.168.1.50", "10.0.2.2:8631/inv"))
    check("إدخال عنوان طابعة البوليصات", fill_edit("192.168.1.51", "10.0.2.2:8631/lbl"))
    check("إدخال اسم المشغّل", fill_edit("اسم المشغّل", "Tester"))
    tap_text("حفظ الإعدادات", 20)
    for _ in range(6):
        swipe(up=False)
    check("حفظ الإعدادات", wait_for("تم الحفظ", 15) is not None)
    tap_text("اختبار الاتصال", 40)
    time.sleep(3)
    for _ in range(6):
        swipe(up=False)
    check("اختبار الاتصال يرسل استعلام قدرات الطابعة (Get-Printer-Attributes) إلى الطابعة", len(QUERIES) >= 1, str(QUERIES))
    print("   (ظهور نتيجة الاختبار على الشاشة:", wait_for("Mock", 8) is not None, ")", flush=True)
    tap_tab("المسح", "امسح رقم الطلب")

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
    deadline = time.time() + 40
    while time.time() < deadline and not (count_prints("/inv") >= 1 and count_prints("/lbl") >= 1):
        time.sleep(1)
    check("طباعة صامتة: الفاتورة أُرسلت إلى طابعتها كملف PDF", count_prints("/inv") == 1 and PRINTS and PRINTS[0][1].startswith(b"%PDF"), str([p for p, _ in PRINTS]))
    check("طباعة صامتة: البوليصة أُرسلت إلى طابعتها كمهمة منفصلة", count_prints("/lbl") == 1)
    scan("5550001112224")
    check("فتح فاتورة ثانية", wait_for("فُتح الطلب 5550001112224", 15) is not None)
    scan("2001")
    tap_text("ترحيل لاستكمال النواقص", 15)
    check("ترحيل بنواقص", wait_for("رُحِّلت الفاتورة", 15) is not None)

    # ---------- تعطيل الطباعة ----------
    sw = find(dump(), "الطباعة التلقائية", exact=False)
    check("مفتاح الطباعة ظاهر في شاشة المسح", sw is not None)
    if sw is not None:
        # المفتاح أول عنصر قابل للضغط في الشريط: نضغط على يمين/يسار الشريط حيث المفتاح
        root = dump()
        switches = [n for n in root.iter("node") if n.attrib.get("class") == "android.widget.Switch"]
        tap(switches[0]) if switches else tap(sw)
    check("تعطيل الطباعة التلقائية", wait_for("الطباعة التلقائية معطّلة", 10) is not None)
    before = len(PRINTS)
    scan("5550001112225")
    scan("3001")
    tap_text("إنهاء الفاتورة", 15)
    check("إقفال الفاتورة الثالثة", wait_for("أُنهيت الفاتورة", 15) is not None)
    time.sleep(8)
    check("لا طباعة عند تعطيل الخاصية", len(PRINTS) == before, f"{before}->{len(PRINTS)}")

    # ---------- لوحة العمل والتقرير ----------
    tap_tab("لوحة العمل", "مراجعة فواتير التجهيز")
    root_ok = wait_for("تقدم المراجعة", 20)
    check("لوحة العمل تعرض التقدم", root_ok is not None)
    tap_tab("التقرير", "تقرير الأخطاء")
    check("شاشة التقرير تعرض أخطاء التجهيز", wait_for("أخطاء التجهيز", 20) is not None)
    root = dump()
    check("التقرير يسرد الكود الخاطئ 9999", find(root, "9999") is not None)
    check("التقرير يسجل اسم المشغّل", find(root, "Tester") is not None)
    check("سجل الطباعة في التقرير", wait_for("سجل الطباعة الصامتة", 40) is not None)
    tap_tab("لوحة العمل", "مراجعة فواتير التجهيز")
    check("لوحة العمل تعرض مؤشرات الأداء", wait_for("مؤشرات الأداء", 20) is not None)


try:
    main()
finally:
    print("\nlogcat (أخطاء التطبيق):", flush=True)
    log = adb("logcat", "-d", "-s", "ReactNativeJS:E", "AndroidRuntime:E")
    print(log[-3000:])
    print("\nالنتيجة:", "نجحت كل الفحوص" if not failures else f"فشل {len(failures)}: {failures}")
    sys.exit(1 if failures else 0)
