import { useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/utils";
import { emojiChar, LOCK_EMOJIS, type LockEmoji } from "../utils/emojiPattern";

const COLUMNS = 3;

/** Klavye ile gezinmede bir satır kaç resim olduğu. */
const ROW_STEP: Record<string, number> = {
  ArrowRight: 1,
  ArrowLeft: -1,
  ArrowDown: COLUMNS,
  ArrowUp: -COLUMNS,
};

interface EmojiPatternGridProps {
  /** Seçilen desen — vurgulanacak resimler. */
  selected: readonly string[];
  onSelect: (id: string) => void;
  emojis?: readonly LockEmoji[];
  /** Kilitlenme/erken çıkış sırasında tüm kısayollar kapanır. */
  disabled?: boolean;
  /** Yanlış denemede kısayol ızgarasını sarsar. */
  isShaking?: boolean;
  className?: string;
  itemClassName?: string;
  label?: string;
}

/**
 * Desen kısayolları: tek bir Tab durağı + ok tuşlarıyla gezinme.
 *
 * Roving `tabIndex` kullanılır (APG "toolbar" kalıbı): odak ızgarada
 * kalır, Tab bir sonraki bileşene geçer. Her buton normal bir `<button>`
 * olduğu için Enter/Space doğal olarak çalışır; ayrı `role="radio"`
 * katmanı gerekmez çünkü desen sıralı çoklu seçimdir, tek seçim değil.
 * Seçim durumu ekran okuyucuya `role="status"` ile duyurulur.
 */
export function EmojiPatternGrid({
  selected,
  onSelect,
  emojis = LOCK_EMOJIS,
  disabled = false,
  isShaking = false,
  className,
  itemClassName,
  label = "Desen resimleri",
}: EmojiPatternGridProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  const focusAt = (index: number) => {
    const next = Math.min(Math.max(index, 0), emojis.length - 1);
    setActiveIndex(next);
    buttons.current[next]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const step = ROW_STEP[event.key];
    if (step !== undefined) {
      event.preventDefault();
      focusAt(activeIndex + step);
      return;
    }
    if (event.key === "Home") {
      event.preventDefault();
      focusAt(0);
    } else if (event.key === "End") {
      event.preventDefault();
      focusAt(emojis.length - 1);
    }
  };

  return (
    <>
      <div
        role="toolbar"
        aria-label={label}
        aria-orientation="horizontal"
        onKeyDown={handleKeyDown}
        className={cn(
          "grid grid-cols-3 gap-3 max-w-70 mx-auto",
          isShaking && "animate-shake",
          className,
        )}
      >
        {emojis.map((emoji, index) => (
          <button
            key={emoji.id}
            type="button"
            ref={(node) => {
              buttons.current[index] = node;
            }}
            tabIndex={!disabled && index === activeIndex ? 0 : -1}
            disabled={disabled}
            onFocus={() => setActiveIndex(index)}
            onClick={() => onSelect(emoji.id)}
            data-selected={selected.includes(emoji.id) || undefined}
            className={cn(
              "aspect-square rounded-card border-2 flex flex-col items-center justify-center bg-card",
              "hover:border-amber-400/50 hover:bg-amber-400/5 active:scale-90 transition-all",
              "border-border disabled:opacity-50 disabled:pointer-events-none",
              "data-selected:border-amber-500 data-selected:bg-amber-500/5 data-selected:scale-95",
              itemClassName,
            )}
          >
            <span aria-hidden="true" className="text-2xl filter drop-shadow-sm mb-0.5">
              {emoji.char}
            </span>
            <span className="text-[10px] font-semibold text-muted-foreground/60">{emoji.name}</span>
          </button>
        ))}
      </div>
      <p role="status" className="sr-only">
        {selected.length > 0
          ? `${selected.map(emojiChar).join(" ")} — ${selected.length} resim seçildi`
          : "Henüz resim seçilmedi"}
      </p>
    </>
  );
}
