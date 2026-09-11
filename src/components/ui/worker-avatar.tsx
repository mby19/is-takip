import type { WorkerType } from "../../types";

const SIZES = {
  xs: "w-6 h-6 text-[11px]",
  sm: "w-8 h-8 text-[13px]",
  md: "w-10 h-10 text-[15px]",
} as const;

/**
 * Çalışan avatarı: baş harf + tipe göre renk.
 * Tek yerde tanımlı, böylece listeler, gün sayfası ve detay ekranı ayrışmaz.
 */
export function WorkerAvatar({
  name,
  type,
  size = "sm",
  initials,
  className = "",
}: {
  name: string;
  type: WorkerType;
  size?: keyof typeof SIZES;
  /**
   * Ekip genelinde benzersizliği garanti edilmiş baş harf.
   * Verilmezse ismin ilk harfi kullanılır — aynı harfle başlayan iki kişi
   * olabilecek listelerde `workerInitials` ile hesaplanıp geçilmeli.
   */
  initials?: string;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`${SIZES[size]} rounded-full grid place-items-center font-semibold shrink-0 ${
        type === "ORTAK" ? "bg-warn text-on-warn" : "bg-primary text-primary-foreground"
      } ${className}`}
    >
      {initials ?? name.trim().charAt(0).toLocaleUpperCase("tr-TR")}
    </span>
  );
}
