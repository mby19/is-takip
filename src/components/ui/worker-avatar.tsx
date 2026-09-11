import type { WorkerType } from "../../types";

const SIZES = {
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
  className = "",
}: {
  name: string;
  type: WorkerType;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      aria-hidden
      className={`${SIZES[size]} rounded-full grid place-items-center font-semibold text-white shrink-0 ${
        type === "ORTAK" ? "bg-warn" : "bg-primary"
      } ${className}`}
    >
      {name.trim().charAt(0).toLocaleUpperCase("tr-TR")}
    </span>
  );
}
