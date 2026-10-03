import { useEffect, useRef } from "react";

/**
 * Animates 0 → target with ease-out cubic deceleration.
 *
 * Değer React state olarak DEĞİL, doğrudan DOM düğümüne yazılır. State
 * üzerinden sürülseydi her karede `setValue` çağrısı yapılır, bu da saniyede
 * ~180 kez içinde bulunduğu bileşenin — takvimdeyse tüm grid'in — yeniden
 * çizilmesi demekti. Sayaç bir ekranın sadece üç hanesini oynattığı için
 * re-render hiçbir şey kazandırmıyordu; DOM'a yazmak aynı görseli bedelsiz
 * verir.
 *
 * Replays whenever `target` or `key` changes (pass `key` to force restart).
 *
 * @param node Yazılacak düğüm; henüz bağlanmamışsa animasyon çalışmaz.
 * @param target Hedef değer.
 * @param format Kare değerini metne çeviren fonksiyon (her render'da değişebilir).
 * @param key Hedef değişmese bile animasyonu yeniden başlatmak için.
 * @param duration Animasyon süresi, ms.
 */
export function useAnimatedCounter(
  node: HTMLElement | null,
  target: number,
  format: (value: number) => string,
  key?: string,
  duration = 1000,
): void {
  const formatRef = useRef(format);
  formatRef.current = format;

  useEffect(() => {
    const el = node;
    if (!el) return;

    // `prefers-reduced-motion` bu animasyonu CSS susturamaz: kareler doğrudan
    // DOM'a yazılıyor, ortada animasyonlu bir CSS özelliği yok. Karar JS'te
    // verilir — hedef değer TEK yazımda konur, rAF döngüsü hiç kurulmaz.
    const reduced =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      el.textContent = formatRef.current(target);
      return;
    }

    const startTime = performance.now();

    let rafId = 0;

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic: fast start, decelerates toward end
      const eased = 1 - Math.pow(1 - progress, 3);

      el.textContent = formatRef.current(Math.round(target * eased));

      if (progress < 1) {
        rafId = requestAnimationFrame(animate);
      }
    };

    rafId = requestAnimationFrame(animate);

    // Yalnızca ilk kare değil, kendini yeniden planlayan HER kare iptal
    // edilmeli: eski hedefin animasyonu bitmeye devam ederse son karede
    // eski değeri DOM'a yazar ve yeni hedefi ezer.
    return () => cancelAnimationFrame(rafId);
  }, [node, target, duration, key]);
}
