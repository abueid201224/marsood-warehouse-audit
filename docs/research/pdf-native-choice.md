# قرار استخراج PDF على Android

يستخدم Android مكتبة `expo-pdf-text-extract` بإصدار 1.1.0 لاستخراج النص المضمّن محلياً عبر PDFBox. يذكر المستودع توافقه المعلن مع Expo SDK 49+ وReact Native 0.72+، لكنه يحتاج Development Build ولا يعمل في Expo Go. كما يميز بين PDF الرقمي ذي طبقة النص وملف المسح الضوئي الذي يحتاج OCR منفصلاً [1].

راجعت تعريف وحدة Expo وإعداد Gradle ومصدر Kotlin. يفتح التنفيذ مسار `file://` أو `content://` محلياً ويقرأه عبر PDFBox؛ لا توجد في دالة الاستخراج عملية رفع أو طلب شبكة [2]. يضيف البناء Android تبعية PDFBox ويحتاج تنزيلها أثناء Gradle build؛ هذا شرط بناء فقط وليس اتصالاً مطلوباً وقت تشغيل التطبيق [3].

ستبقى معاينة الويب مبنية على PDF.js، بينما يستخدم Android الوحدة الأصلية لتفادي إدراج Worker ديناميكي لا يمر عبر حزمة Android. ما زال التعرف على صفوف الفاتورة تخميناً بنيوياً حذراً، ولذلك لا يعتمد التطبيق أي سطر PDF قبل مراجعته يدوياً. المستند المصور أو الفارغ لا يُعامل كفاتورة مستخرجة؛ OCR غير متوفر في هذا الإصدار [1].

المخاطر المتبقية: الحزمة المجتمعية صغيرة وحديثة، ولم يُنشأ Android APK بعد لتشغيل اختبار الجهاز. يجب التأكد من بناء Gradle ومن استيراد PDF نصي محلي في أول نسخة APK؛ نجاح اختبار PDF.js في الويب لا يثبت عمل الوحدة الأصلية.

## المراجع

[1]: https://github.com/gr8pathik/expo-pdf-text-extract "expo-pdf-text-extract README"
[2]: https://github.com/gr8pathik/expo-pdf-text-extract/blob/main/android/src/main/java/expo/modules/pdfextractor/PdfExtractorModule.kt "Android PDF extractor source"
[3]: https://github.com/gr8pathik/expo-pdf-text-extract/blob/main/android/build.gradle "Android native build configuration"
