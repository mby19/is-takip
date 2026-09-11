import { format, parseISO } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Payment } from "../types";
import type { WorkerStats } from "../utils/calculations";
import { isTauri, saveFileToDownloads } from "./tauri";

type AutoTableOptions = Record<string, unknown>;

interface JsPDFWithTable {
  addFileToVFS: (fileName: string, data: string) => void;
  addFont: (fileName: string, fontName: string, fontStyle: string) => void;
  setFontSize: (size: number) => void;
  setFont: (name: string, style?: string) => void;
  text: (text: string, x: number, y: number) => void;
  output: (type: "arraybuffer") => ArrayBuffer;
  save: (name: string) => void;
  autoTable: (options: AutoTableOptions) => void;
  lastAutoTable?: { finalY: number };
}

const STATUS_LABEL: Record<string, string> = {
  FULL: "Tam",
  HALF: "Yarım",
  ABSENT: "Yok",
  HOLIDAY: "İzin",
};

const money = (n: number) => `${Math.round(n).toLocaleString("tr-TR")} TL`;

/**
 * Aylık hakediş raporunu PDF olarak üretir ve kaydeder.
 *
 * jsPDF yalnızca bu fonksiyon çağrıldığında yüklenir — açılışta paketlenmez.
 * Kaydedilen dosyanın adını döndürür.
 */
export async function exportWorkerReport(
  worker: Worker,
  currentMonth: Date,
  stats: WorkerStats,
  payments: readonly Payment[],
): Promise<string> {
  const [{ default: JsPDF }] = await Promise.all([import("jspdf"), import("jspdf-autotable")]);
  const { registerTurkishFont } = await import("./pdfFont");

  const doc = new JsPDF() as unknown as JsPDFWithTable;
  await registerTurkishFont(doc);
  doc.setFont("Inter");

  const monthStr = format(currentMonth, "MMMM yyyy", { locale: tr });

  doc.setFontSize(18);
  doc.setFont("Inter", "black");
  doc.text("Aylık Çalışma ve Hakediş Dökümü", 14, 22);

  doc.setFontSize(11);
  doc.setFont("Inter", "normal");
  doc.text(`Çalışan: ${worker.name}`, 14, 32);
  doc.text(`Dönem: ${monthStr}`, 14, 38);
  doc.text(
    `Bu ay hakediş: ${money(stats.totalEarnedInMonth)}   |   Bu ay ödenen: ${money(stats.paidInMonth)}`,
    14,
    44,
  );
  doc.text(`Dönem bakiyesi: ${money(stats.periodBalance)}`, 14, 50);
  doc.text(
    `Genel toplam hakediş: ${money(stats.totalEarnedAllTime)}   |   Genel ödenen: ${money(stats.totalPaid)}`,
    14,
    56,
  );
  doc.setFont("Inter", "bold");
  doc.text(`Kalan borç (tüm dönemler): ${money(stats.balance)}`, 14, 62);
  doc.setFont("Inter", "normal");

  const tableBody = stats.dailyBreakdown.map((day) => [
    `${day.dayNum} ${day.dayName}`,
    day.status ? (STATUS_LABEL[day.status] ?? day.status) : "-",
    day.earned !== 0 ? money(day.earned) : "-",
  ]);

  if (tableBody.length > 0) {
    doc.autoTable({
      startY: 68,
      head: [["Tarih", "Durum", "Hakediş"]],
      body: tableBody,
      theme: "grid",
      headStyles: { fillColor: [59, 130, 246] },
      styles: { font: "Inter" },
    });
  }

  const finalY = doc.lastAutoTable?.finalY ?? 68;
  const monthPrefix = format(currentMonth, "yyyy-MM");
  const monthlyPayments = payments.filter(
    (p) => String(p.date).startsWith(monthPrefix) && Number(p.worker_id) === Number(worker.id),
  );

  if (monthlyPayments.length > 0) {
    doc.setFont("Inter", "bold");
    doc.text("Bu Ay Yapılan Ödemeler / Avanslar", 14, finalY + 15);
    doc.autoTable({
      startY: finalY + 20,
      head: [["Tarih", "Açıklama", "Tutar"]],
      body: monthlyPayments.map((p) => [
        format(parseISO(p.date), "dd MMM yyyy", { locale: tr }),
        p.description || "Nakit Ödeme",
        money(p.amount),
      ]),
      theme: "striped",
      headStyles: { fillColor: [16, 185, 129] },
      styles: { font: "Inter" },
    });
  }

  const fileName = `${worker.name.replace(/[^\p{L}\p{N}]+/gu, "_")}_${monthPrefix}_Raporu.pdf`;

  if (isTauri()) {
    await saveFileToDownloads(fileName, new Uint8Array(doc.output("arraybuffer")));
  } else {
    doc.save(fileName);
  }

  return fileName;
}
