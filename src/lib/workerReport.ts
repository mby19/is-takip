import { format, parseISO } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Payment } from "../types";
import type { WorkerStats } from "../utils/calculations";
import { PDF_FONT, PDF_FONT_WARNING, toWinAnsiText } from "./pdfFont";
import { isTauri, saveFileToDownloads, saveFileWithPicker } from "./tauri";

/**
 * jsPDF + eklenti yüzeyi.
 *
 * `autoTable`/`lastAutoTable` çalışma anında `applyPlugin` ile takılır; bu
 * yüzden opsiyoneldir ve aşağıda yoklukları ayrıca kontrol edilir.
 */
interface JsPDFWithTable {
  setFontSize: (size: number) => void;
  setFont: (name: string, style?: string) => void;
  text: (text: string, x: number, y: number) => void;
  splitTextToSize: (text: string, maxWidth: number) => string[];
  output: (type: "arraybuffer") => ArrayBuffer;
  save: (name: string) => void;
  autoTable?: (options: Record<string, unknown>) => void;
  lastAutoTable?: { finalY: number } | false;
}

const STATUS_LABEL: Record<string, string> = {
  FULL: "Tam",
  HALF: "Yarım",
  ABSENT: "Yok",
};

/**
 * Para birimi gösterimi.
 *
 * UI `₺` öneki kullanır; jsPDF'in yerleşik fontları cp1252 kodladığı için `₺`
 * glifi yok (bkz. `pdfFont.ts`). PDF bu yüzden **yalnızca** `TL` suffix'i
 * kullanır — belgede iki gösterim bir arada bulunmaz.
 */
const money = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} TL`;

/**
 * Aylık hakediş raporunu PDF olarak üretir ve kaydeder.
 *
 * jsPDF yalnızca bu fonksiyon çağrıldığında yüklenir — açılışta paketlenmez.
 *
 * Hedefi kullanıcı seçer (Android'de SAF; İndirilenler, Drive vb.). Böylece
 * rapor bulunabilir bir yere iner. Diyalog kullanılamazsa uygulama klasörüne
 * düşülür. Kullanıcı vazgeçerse `null` döner.
 *
 * Türkçe karakterler: cp1252 kapsamı dışındaki harfler `toWinAnsiText` ile
 * sadeleştirilir; dönüşüm yapıldıysa belgenin sonuna uyarı satırı eklenir.
 */
export async function exportWorkerReport(
  worker: Worker,
  currentMonth: Date,
  stats: WorkerStats,
  payments: readonly Payment[],
): Promise<string | null> {
  const [{ default: JsPDF }, { applyPlugin }] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);

  // Eklenti `jsPDF` sınıfını globalde arar; ESM yüklemesinde global yoktur, bu
  // yüzden açıkça uygulanmalı. Aksi halde `doc.autoTable` undefined kalır.
  applyPlugin(JsPDF);

  const doc = new JsPDF() as unknown as JsPDFWithTable;
  if (typeof doc.autoTable !== "function") {
    throw new Error("PDF tablo bileşeni yüklenemedi (jspdf-autotable).");
  }
  const drawTable = doc.autoTable;

  let foldedChars = 0;
  /** Metni PDF'e yazılabilir hâle getirir ve dönüşüm sayacını tutar. */
  const t = (raw: string): string => {
    const { text, foldedCount } = toWinAnsiText(raw);
    foldedChars += foldedCount;
    return text;
  };

  /** Son tablonun bittiği y — `lastAutoTable` false ise verilen yedeğe düşer. */
  const tableEndY = (fallback: number): number => {
    const last = doc.lastAutoTable;
    return last && typeof last === "object" ? last.finalY : fallback;
  };

  doc.setFontSize(18);
  doc.setFont(PDF_FONT, "bold");
  doc.text(t("Aylık Çalışma ve Hakediş Dökümü"), 14, 22);

  const monthStr = format(currentMonth, "MMMM yyyy", { locale: tr });

  doc.setFontSize(11);
  doc.setFont(PDF_FONT, "normal");
  doc.text(t(`Çalışan: ${worker.name}`), 14, 32);
  doc.text(t(`Dönem: ${monthStr}`), 14, 38);
  doc.text(
    t(
      `Bu ay hakediş: ${money(stats.totalEarnedInMonth)}   |   Bu ay ödenen: ${money(stats.paidInMonth)}`,
    ),
    14,
    44,
  );
  doc.text(t(`Dönem bakiyesi: ${money(stats.periodBalance)}`), 14, 50);
  doc.text(
    t(
      `Genel toplam hakediş: ${money(stats.totalEarnedAllTime)}   |   Genel ödenen: ${money(stats.totalPaid)}`,
    ),
    14,
    56,
  );
  doc.setFont(PDF_FONT, "bold");
  doc.text(t(`Kalan borç (tüm dönemler): ${money(stats.balance)}`), 14, 62);
  doc.setFont(PDF_FONT, "normal");

  const tableBody = stats.dailyBreakdown.map((day) => [
    t(`${day.dayNum} ${day.dayName}`),
    t(day.status ? (STATUS_LABEL[day.status] ?? day.status) : "-"),
    day.earned !== 0 ? t(money(day.earned)) : "-",
  ]);

  if (tableBody.length > 0) {
    drawTable({
      startY: 68,
      head: [[t("Tarih"), t("Durum"), t("Hakediş")]],
      body: tableBody,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246] },
      styles: { font: PDF_FONT },
    });
  }

  let finalY = tableEndY(68);

  const monthPrefix = format(currentMonth, "yyyy-MM");
  const monthlyPayments = payments.filter(
    (p) => String(p.date).startsWith(monthPrefix) && Number(p.worker_id) === Number(worker.id),
  );

  if (monthlyPayments.length > 0) {
    doc.setFont(PDF_FONT, "bold");
    doc.text(t("Bu Ay Yapılan Ödemeler / Avanslar"), 14, finalY + 15);
    drawTable({
      startY: finalY + 20,
      head: [[t("Tarih"), t("Açıklama"), t("Tutar")]],
      body: monthlyPayments.map((p) => [
        t(format(parseISO(p.date), "dd MMM yyyy", { locale: tr })),
        t(p.description || "Nakit Ödeme"),
        t(money(p.amount)),
      ]),
      theme: "striped",
      headStyles: { fillColor: [16, 185, 129] },
      styles: { font: PDF_FONT },
    });
    finalY = tableEndY(finalY + 20);
  }

  // Karakter dönüşümü yapıldıysa uyarı belge içine de yazılır: kullanıcı
  // sadeleştirmeyi belgenin kendisinde görür, toast'tan sonra unutmaz.
  if (foldedChars > 0) {
    doc.setFontSize(8);
    doc.setFont(PDF_FONT, "normal");
    // Uzun satır sayfa kenarını taşmasın.
    doc
      .splitTextToSize(PDF_FONT_WARNING, 182)
      .forEach((line, i) => doc.text(line, 14, finalY + 14 + i * 5));
  }

  const fileName = `${worker.name.replace(/[^\p{L}\p{N}]+/gu, "_")}_${monthPrefix}_Raporu.pdf`;

  if (!isTauri()) {
    doc.save(fileName);
    return fileName;
  }

  const bytes = new Uint8Array(doc.output("arraybuffer"));
  try {
    return await saveFileWithPicker(fileName, bytes);
  } catch {
    // Diyalog açılamadıysa (izin/eklenti sorunu) sessizce kaybetme.
    await saveFileToDownloads(fileName, bytes);
    return fileName;
  }
}
