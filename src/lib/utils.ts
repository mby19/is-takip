import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Para gösterimi — TEK KAYNAK.
 *
 * Ekranda görünen her tutar buradan geçer: kuruş gösterilmez, ondalık
 * yuvarlanır ve binlik ayraç Türkçe olur (`₺1.250`). Kopyalar tutulduğunda
 * biri yuvarlamayı, öteki çeviriyi unutup aynı rakam iki biçimde görünür.
 *
 * `null`/`undefined` 0 kabul edilir (log kaydındaki eksik alan "sıfır" demek
 * değil, "o gün için veri yok" demektir); sonuç yine de NaN ise `"—"`
 * döner, ekranda `₺NaN` görünmesin diye.
 *
 * PDF bu yardımcıyı **kullanmaz**: jsPDF'in yerleşik fontları cp1252
 * kodladığı için `₺` glifi yoktur (bkz. `pdfFont.ts`), orada suffix `TL`
 * olmak zorundadır (bkz. `workerReport.ts`).
 */
export function formatMoney(value?: string | number | null): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "—";
  return `₺${Math.round(n).toLocaleString("tr-TR")}`;
}
