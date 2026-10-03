import { useCallback, useEffect, useRef } from "react";

/**
 * Unmount sırasında otomatik temizlenen `setTimeout` kaydı.
 *
 * Kilit ekranlarındaki geçiş gecikmeleri (adım atlama, titretme, hata sıfırlama)
 * bileşen kapandıktan sonra da `setState` çağırmasın diye tek yerde toplanır.
 */
export function useTimeouts() {
  const timers = useRef<Set<number>>(new Set());

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  /** `fn` callback'ini `ms` sonra çalıştırır; callback çalışınca kayıt düşer. */
  return useCallback((fn: () => void, ms: number) => {
    const id = window.setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
    return id;
  }, []);
}
