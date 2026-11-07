import type { IppTransport } from "./ipp";

/** ينقل رسالة IPP عبر HTTP (XMLHttpRequest في React Native يدعم الجسم الثنائي والاستجابة الثنائية). */
export const xhrTransport: IppTransport = (url, body, timeoutMs) =>
  new Promise<Uint8Array>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.responseType = "arraybuffer";
    xhr.timeout = timeoutMs;
    xhr.setRequestHeader("Content-Type", "application/ipp");
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(new Uint8Array(xhr.response as ArrayBuffer));
      else reject(new Error(`ردّ الخادم برمز HTTP ${xhr.status}. تحقق من عنوان الطابعة ومسار IPP.`));
    };
    xhr.onerror = () => reject(new Error("تعذر الاتصال بالطابعة. تأكد من عنوانها وأن الجهاز على الشبكة نفسها."));
    xhr.ontimeout = () => reject(new Error("انتهت مهلة الاتصال بالطابعة."));
    xhr.send(body as unknown as XMLHttpRequestBodyInit);
  });
