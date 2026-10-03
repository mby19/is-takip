import { resolveWorkerRate } from "../utils/earningsCalculator";
import { buildPeriodIndex, buildWorkerStats, calculatePeriodEarnings } from "./periodStats";
import { periodOf } from "./period";
import type {
  Attendance,
  AttendanceStatus,
  DailyMetric,
  Payment,
  Worker,
  WorkerRate,
} from "../types";
import type { WorkerStats } from "../utils/calculations";
import { isTauri, saveFileWithPicker, saveTextFileToDownloads } from "./tauri";

/* ------------------------------------------------------------------ *
 * Biçim kuralları — Türkiye / Excel gerçeği
 * ------------------------------------------------------------------ */

/**
 * Ayraç `;` olmalı, `,` değil.
 *
 * Neden: Türkiye (ve birçok Avrupa) locale'inde ondalık ayracı `,`. `,`
 * ayraçlı bir CSV Excel'de açıldığında `1234.56` gibi bir sayı hücre
 * sınırını böler ve tüm satır TEK sütun olarak okunur. `;` ayraçlı
 * dosyada ise ondalık `,` olan sayılar doğru parse edilir.
 */
export const CSV_DELIMITER = ";";

/**
 * UTF-8 BOM. Excel, BOM'suz UTF-8 dosyada Türkçe harfleri (İ, ğ, ş, ç, ö, ü)
 * yanlış kodlayıp bozabilir. BOM dosyanın başına eklenince Excel bunu
 * "bu dosya UTF-8" diye tanır ve karakterler bozulmaz.
 */
export const CSV_BOM = "﻿";

/** Satır sonu — RFC 4180 ve Excel uyumu için CRLF. */
const NEWLINE = "\r\n";

const STATUS_LABEL: Record<AttendanceStatus, string> = {
  FULL: "Tam",
  HALF: "Yarım",
  ABSENT: "Yok",
  HOLIDAY: "Tatil",
};

const TYPE_LABEL: Record<Worker["worker_type"], string> = {
  GUNLUK: "Günlük",
  ORTAK: "Ortak",
};

/* ------------------------------------------------------------------ *
 * Alan biçimlendirme
 * ------------------------------------------------------------------ */

/**
 * Para alanı: nokta ondalıklı, iki hane, binlik ayracı yok.
 * Excel Türkçe locale'de `1234.56` değerini doğru sayı olarak okur.
 * `-0.00` üretmemek için sıfır normalize edilir.
 *
 * Ekrandaki `formatMoney` (`lib/utils.ts`) ile **kasıtlı olarak farklıdır**:
 * o birim kuruşu göstermez ve `₺` simgesi koyar, buradaki ise kuruşu
 * korur ve simgesizdir — çünkü hedef dosya elektronik tablo, orada `₺`
 * bir metin karakteridir ve hücreyi sayı olmaktan çıkarır. Aynı isimde
 * iki farklı çıktı üreten fonksiyonlar "sessiz yanlış tutar" riskidir,
 * bu yüzden adları ayrıdır.
 */
export function formatCsvMoney(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  const safe = rounded === 0 ? 0 : rounded;
  return safe.toFixed(2);
}

/**
 * Miktar (palet vb.): nokta ondalıklı, sondaki gereksiz sıfırlar atılmış.
 * `12` → "12", `12.5` → "12.5".
 */
export function formatQuantity(value: number): string {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  const safe = rounded === 0 ? 0 : rounded;
  return String(safe);
}

/**
 * Tek alanı RFC 4180'e göre kaçırır.
 *
 * Alan içinde ayraç (`;`), tırnak (`"`) veya satır sonu varsa alan tırnak
 * içine alınır ve içteki tırnaklar ikiye katlanır. Çalışan adı `;` veya
 * tırnak içerebilir; kaçırmazsa sütun sayısı kayar ve muhasebeci yanlış
 * sütunu okur.
 */
export function escapeCsvField(value: string): string {
  if (/[";\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Satırları `;` ile birleştirip CRLF ile döndürür (BOM eklenmez). */
export function toCsv(
  headers: readonly string[],
  rows: readonly (readonly (string | number)[])[],
): string {
  const lines = [headers.map(escapeCsvField).join(CSV_DELIMITER)];
  for (const row of rows) {
    lines.push(row.map((cell) => escapeCsvField(String(cell))).join(CSV_DELIMITER));
  }
  return lines.join(NEWLINE);
}

/** Dosya adındaki isimdeki boşluk/özel karakterleri alt çizgiye çevirir. */
function sanitizeFileToken(token: string): string {
  const cleaned = token.replace(/[^\p{L}\p{N}]+/gu, "_").replace(/^_+|_+$/g, "");
  return cleaned || "veri";
}

/* ------------------------------------------------------------------ *
 * Bölümler
 * ------------------------------------------------------------------ */

const WORKERS_TITLE = "Çalışanlar";
const ATTENDANCE_TITLE = "Günlük Devam";
const METRICS_TITLE = "Günlük Veriler";
const PAYMENTS_TITLE = "Ödemeler";
const SUMMARY_TITLE = "Ay Sonu Dökümü";
const BUSINESS_TITLE = "İşletme Özeti";

/**
 * Bir dönemin İŞLETME düzeyi sonuçları.
 *
 * Neden ayrı bölüm: `undistributed` bir çalışana değil, işletmeye aittir.
 * Ay Sonu Dökümü'ndeki her satıra tekrarlansaydı muhasebeci bu sütunu
 * Excel'de topladığında (çalışan sayısı × tutar) yanlış bir işletme tutarı
 * görürdü — para hesabı olan bir uygulamada kabul edilemez. Bu yüzden
 * dönem başına TEK satır olarak ayrı bölümde durur.
 */
export interface PeriodBusinessRow {
  period: string;
  /** Dönemdeki günlerin net kâr toplamı (işaretli). */
  netProfit: number;
  /** Dönemdeki günlerin yevmiye maliyeti toplamı. */
  wageCost: number;
  /**
   * Ortaklara **dağıtılmayan** net kâr/zarar (işaretli, ADR-0009 / K3).
   * Zararlı günde ortak payı 0'a düştüğü için zarar, aktif ortak bulunmayan
   * kârlı günde ise kâr burada birikir. `Σ çalışan hakedişleri + undistributed
   * = netProfit + wageCost` değişmezi buradan doğrulanır.
   */
  undistributed: number;
}

export function buildBusinessSummaryCsv(rows: readonly PeriodBusinessRow[]): string {
  const sorted = [...rows].sort((a, b) => a.period.localeCompare(b.period));
  return toCsv(
    ["Dönem", "Net Kâr", "Yevmiye Maliyeti", "Dağıtılmayan Kâr/Zarar (undistributed)"],
    sorted.map((r) => [
      r.period,
      formatCsvMoney(r.netProfit),
      formatCsvMoney(r.wageCost),
      formatCsvMoney(r.undistributed),
    ]),
  );
}

export function buildWorkersCsv(workers: readonly Worker[]): string {
  const rows = [...workers]
    .sort((a, b) => a.id - b.id)
    .map((w) => [
      w.id,
      w.name,
      TYPE_LABEL[w.worker_type] ?? w.worker_type,
      formatCsvMoney(w.daily_wage),
      w.is_active ? "Aktif" : "Pasif",
    ]);
  return toCsv(["ID", "Ad", "Tip", "Günlük Ücret", "Durum"], rows);
}

export function buildAttendanceCsv(
  attendance: readonly Attendance[],
  nameOf: (workerId: number) => string,
): string {
  const rows = [...attendance]
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) || Number(a.worker_id) - Number(b.worker_id),
    )
    .map((a) => [
      Number(a.worker_id),
      nameOf(Number(a.worker_id)),
      String(a.date).trim(),
      STATUS_LABEL[a.status] ?? a.status,
    ]);
  return toCsv(["Çalışan ID", "Çalışan", "Tarih", "Durum"], rows);
}

export function buildMetricsCsv(metrics: readonly DailyMetric[]): string {
  const rows = [...metrics]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .map((m) => [
      String(m.date).trim(),
      formatQuantity(m.production_amount),
      formatCsvMoney(m.total_earned),
      formatCsvMoney(m.extra_expenses),
      m.is_holiday ? "Evet" : "Hayır",
    ]);
  return toCsv(["Tarih", "Üretim (Palet)", "Ciro", "Gider", "Tatil"], rows);
}

export function buildPaymentsCsv(
  payments: readonly Payment[],
  nameOf: (workerId: number) => string,
): string {
  const rows = [...payments]
    .sort(
      (a, b) =>
        String(a.date).localeCompare(String(b.date)) || Number(a.worker_id) - Number(b.worker_id),
    )
    .map((p) => [
      Number(p.worker_id),
      nameOf(Number(p.worker_id)),
      String(p.date).trim(),
      formatCsvMoney(p.amount),
      p.description ?? "",
    ]);
  return toCsv(["Çalışan ID", "Çalışan", "Tarih", "Tutar", "Açıklama"], rows);
}

export interface PeriodSummaryRow {
  workerId: number;
  name: string;
  period: string;
  earned: number;
  paid: number;
  balance: number;
  /** Çalışan dönem boyunca ORTAK ise hakedişinin tamamı, değilse 0. */
  partnerShare: number;
}

export function buildPeriodSummaryCsv(rows: readonly PeriodSummaryRow[]): string {
  const sorted = [...rows].sort(
    (a, b) => a.period.localeCompare(b.period) || a.workerId - b.workerId,
  );
  return toCsv(
    ["Çalışan", "Dönem", "Hakediş", "Ödenen", "Bakiye", "Ortak Payı"],
    sorted.map((r) => [
      r.name,
      r.period,
      formatCsvMoney(r.earned),
      formatCsvMoney(r.paid),
      formatCsvMoney(r.balance),
      formatCsvMoney(r.partnerShare),
    ]),
  );
}

/* ------------------------------------------------------------------ *
 * Kapsam (scope) ve bütün dosya
 * ------------------------------------------------------------------ */

export type ExportScope =
  | { kind: "all" }
  | { kind: "worker"; workerId: number }
  | { kind: "month"; period: string };

export interface ExportInput {
  workers: readonly Worker[];
  attendance: readonly Attendance[];
  metrics: readonly DailyMetric[];
  payments: readonly Payment[];
  rateHistory: readonly WorkerRate[];
  scope: ExportScope;
}

function monthDateOf(period: string): Date {
  const [y, m] = period.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, 1);
}

function inScopeDate(date: string, scope: ExportScope): boolean {
  return scope.kind === "month" ? periodOf(date) === scope.period : true;
}

function inScopeWorker(workerId: number, scope: ExportScope): boolean {
  return scope.kind === "worker" ? workerId === scope.workerId : true;
}

function distinctPeriods(dates: Iterable<string>): string[] {
  const set = new Set<string>();
  for (const d of dates) set.add(periodOf(d));
  return [...set].sort();
}

/** Dönemin ilk gününe göre çalışanın geçerli tipini çözer. */
function resolvedType(
  worker: Worker,
  period: string,
  rateHistory: readonly WorkerRate[],
): Worker["worker_type"] {
  return resolveWorkerRate(worker, `${period}-01`, rateHistory).worker_type;
}

/** Ay sonu dökümü + dönem başına işletme özeti. */
interface PeriodSummaries {
  rows: PeriodSummaryRow[];
  business: PeriodBusinessRow[];
}

/**
 * Ay sonu dökümünü HESAP KATMANINDAN üretir.
 *
 * Tutar alanları `buildWorkerStats` / `calculatePeriodEarnings`'tan gelir —
 * SQL'de yeniden toplam yapılmaz (tek hesap kaynağı kuralı, ADR-0009).
 * `calculatePeriodEarnings` daima **tüm** çalışan havuzuyla çağrılır: bir
 * ORTAK'ın payı o günkü tüm ekibin hakedişine bağlıdır, tek kişiyle
 * hesaplanırsa yanlış olur. Aynı nedenle `undistributed` de **işletme**
 * düzeyinde, dönem başına tek satır olarak raporlanır.
 */
function buildSummaries(input: ExportInput): PeriodSummaries {
  const empty: PeriodSummaries = { rows: [], business: [] };
  const { workers, attendance, metrics, payments, rateHistory, scope } = input;
  if (workers.length === 0) return empty;

  const index = buildPeriodIndex(attendance, metrics);
  const targetWorkers = workers.filter((w) => inScopeWorker(w.id, scope));

  let periods: string[];
  if (scope.kind === "month") {
    periods = [scope.period];
  } else if (scope.kind === "worker") {
    // Çalışan kaydı bu dönemde olmasa da ekip hakedişi onun payını etkiler;
    // dönem listesi yalnız o çalışanın kendi kayıtlarından türetilir.
    const set = new Set<string>();
    for (const a of attendance)
      if (Number(a.worker_id) === scope.workerId) set.add(periodOf(a.date));
    for (const p of payments) if (Number(p.worker_id) === scope.workerId) set.add(periodOf(p.date));
    periods = [...set].sort();
  } else {
    periods = distinctPeriods([
      ...attendance.map((a) => a.date),
      ...metrics.map((m) => m.date),
      ...payments.map((p) => p.date),
    ]);
  }

  const rows: PeriodSummaryRow[] = [];
  const business: PeriodBusinessRow[] = [];
  for (const period of periods) {
    const periodEarnings = calculatePeriodEarnings(
      workers,
      monthDateOf(period),
      index,
      rateHistory,
    );
    business.push({
      period,
      netProfit: periodEarnings.netProfit,
      wageCost: periodEarnings.wageCost,
      undistributed: periodEarnings.undistributed,
    });
    for (const worker of targetWorkers) {
      const stats: WorkerStats = buildWorkerStats(worker, period, periodEarnings, 0, payments);
      if (stats.totalEarnedInMonth === 0 && stats.paidInMonth === 0) continue;
      rows.push({
        workerId: worker.id,
        name: worker.name,
        period,
        earned: stats.totalEarnedInMonth,
        paid: stats.paidInMonth,
        balance: stats.periodBalance,
        partnerShare:
          resolvedType(worker, period, rateHistory) === "ORTAK" ? stats.totalEarnedInMonth : 0,
      });
    }
  }
  return { rows, business };
}

/**
 * Seçili kapsam için tüm bölümleri birleştirip BOM'lu CSV dosyası döndürür.
 * Her bölüm başlığı, başlık satırı ve veri satırlarından oluşur; bölümler
 * boş satırla ayrılır.
 */
export function buildExportCsv(input: ExportInput): string {
  const { workers, attendance, metrics, payments, scope } = input;

  // Arşivlenmiş çalışanların adları da bilinmeli; puantaj satırı her zaman
  // çalışan adıyla okunmalı.
  const nameMap = new Map<number, string>(workers.map((w) => [w.id, w.name]));
  const nameOf = (workerId: number): string => nameMap.get(workerId) ?? "";

  const scopedWorkers = workers.filter((w) => inScopeWorker(w.id, scope));
  const scopedAttendance = attendance.filter(
    (a) => inScopeDate(a.date, scope) && inScopeWorker(Number(a.worker_id), scope),
  );
  const scopedMetrics = metrics.filter((m) => inScopeDate(m.date, scope));
  const scopedPayments = payments.filter(
    (p) => inScopeDate(p.date, scope) && inScopeWorker(Number(p.worker_id), scope),
  );

  const { rows, business } = buildSummaries(input);
  const sections: { title: string; body: string }[] = [
    { title: WORKERS_TITLE, body: buildWorkersCsv(scopedWorkers) },
    { title: ATTENDANCE_TITLE, body: buildAttendanceCsv(scopedAttendance, nameOf) },
    { title: METRICS_TITLE, body: buildMetricsCsv(scopedMetrics) },
    { title: PAYMENTS_TITLE, body: buildPaymentsCsv(scopedPayments, nameOf) },
    { title: SUMMARY_TITLE, body: buildPeriodSummaryCsv(rows) },
    { title: BUSINESS_TITLE, body: buildBusinessSummaryCsv(business) },
  ];

  const blocks = sections.map((s) => `${s.title}${NEWLINE}${s.body}`);
  return CSV_BOM + blocks.join(NEWLINE + NEWLINE) + NEWLINE;
}

/** Kapsama göre indirilecek dosyanın adı. */
export function exportFileName(scope: ExportScope, workerName?: string): string {
  if (scope.kind === "month") return `is_takip_${scope.period}.csv`;
  if (scope.kind === "worker") return `is_takip_${sanitizeFileToken(workerName || "calisan")}.csv`;
  return "is_takip_tum_veriler.csv";
}

/* ------------------------------------------------------------------ *
 * Dosyayı yaz
 * ------------------------------------------------------------------ */

/**
 * CSV metnini indirir ve gerçek yolunu (veya dosya adını) döndürür.
 *
 * Tauri'de önce kaydetme diyaloğu açılır; diyalog açılamazsa (izin ya da
 * eklenti sorunu) dosya sessizce kaybolmaz, İndirilenler'e yazılır.
 * Kullanıcı diyaloğu iptal ederse `null` döner — hiçbir yer yazılmaz.
 *
 * Web'de Tauri yok; `backup.ts`'teki `writeBackupFile` deseninin aynısı:
 * `Blob` + geçici `<a download>`. MIME `charset=utf-8` ile verilir ki
 * tarayıcı BOM'u ve Türkçe harfleri dosyayı bozmasın.
 */
export async function writeCsvFile(fileName: string, csv: string): Promise<string | null> {
  if (isTauri()) {
    try {
      return await saveFileWithPicker(fileName, csv);
    } catch {
      await saveTextFileToDownloads(fileName, csv);
      return fileName;
    }
  }

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return fileName;
}
