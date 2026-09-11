import type { Worker } from "../../types";
import { resolveWorkerColor, WORKER_INK } from "../../lib/workerAppearance";

const SIZES = {
  xs: "w-6 h-6 text-[11px]",
  sm: "w-8 h-8 text-[13px]",
  md: "w-10 h-10 text-[15px]",
} as const;

/**
 * Çalışan rozeti: kişiye özel renk + kısa etiket.
 *
 * Renk KİMLİĞİ gösterir, tipi değil — tabloda "hangi sütun kim" sorusunun en
 * hızlı cevabı renktir. Tip bilgisi zaten ismin yanında yazıyor. Renk temaya
 * göre değişmez; bir kişinin rengi sabittir.
 */
export function WorkerAvatar({
  worker,
  size = "sm",
  label,
  className = "",
}: {
  worker: Pick<Worker, "id" | "name" | "color" | "short_label">;
  size?: keyof typeof SIZES;
  /**
   * Ekip genelinde benzersizliği garanti edilmiş etiket.
   * Verilmezse çalışanın kendi kısa etiketi, o da yoksa ilk harfi kullanılır.
   */
  label?: string;
  className?: string;
}) {
  const text =
    label ?? worker.short_label ?? worker.name.trim().charAt(0).toLocaleUpperCase("tr-TR") ?? "?";

  return (
    <span
      aria-hidden
      style={{ backgroundColor: resolveWorkerColor(worker), color: WORKER_INK }}
      className={`${SIZES[size]} rounded-full grid place-items-center font-semibold shrink-0 ${className}`}
    >
      {text}
    </span>
  );
}
