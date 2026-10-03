import "jspdf";

/**
 * jspdf-autotable yüzeyi.
 *
 * Gerçeklik: eklenti `applyPlugin(jsPDF)` ile yüklenir ve `jsPDF.API`'ye
 * metotları **çalışma anında** ekler. Yükleme tamamlanmadan bir `new JsPDF()`
 * örneğinde `autoTable` `undefined`'tir — bu yüzden iki üye de opsiyoneldir.
 *
 * `lastAutoTable` eklenti tarafından önce `false` olarak atanır (satır
 * yüksekliği fallback'i için), sonra her `autoTable()` çağrısında tablo
 * nesnesiyle değiştirilir. Bu yüzden tipi `false | Tablo | undefined`.
 */
declare module "jspdf" {
  interface jsPDF {
    autoTable?: (options: Record<string, unknown>) => void;
    lastAutoTable?: { finalY: number } | false;
  }
}
