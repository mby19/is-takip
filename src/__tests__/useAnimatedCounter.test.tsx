import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act, cleanup } from "@testing-library/react";
import { useState } from "react";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";

/**
 * `requestAnimationFrame`'i elle sürülen bir kuyruk.
 *
 * jsdom'un rAF'ı gerçek zamanla çalışır ve kare zamanını bağımsız verir;
 * hook ise `startTime` ile kare zamanının farkını ölçtüğü için ikisini tek
 * bir `clock` üzerinden sürüyoruz. Böylece her kare deterministik olur ve
 * test kaç kare çalıştığını tam olarak bilir.
 */
let clock = 0;
let nextId = 1;
const queue = new Map<number, FrameRequestCallback>();

/** Bir sonraki kareyi işle; kare zamanı `performance.now()` ile aynı değer. */
const flushFrame = (time: number) => {
  clock = time;
  const due = [...queue.values()];
  queue.clear();
  for (const cb of due) cb(time);
};

beforeEach(() => {
  clock = 0;
  nextId = 1;
  queue.clear();
  vi.spyOn(performance, "now").mockImplementation(() => clock);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb: FrameRequestCallback) => {
    const id = nextId++;
    queue.set(id, cb);
    return id;
  });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id: number) => {
    queue.delete(id);
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const plain = (v: number) => String(v);

/** Sayaç + hedefi değiştiren düğme. `renders` render sayacını tutar. */
const renderCounter = (
  initialTarget: number,
  options: {
    format?: (value: number) => string;
    // Süre hedefe göre değişebilir: uzun süren eski animasyonun, kısa süren
    // yenisinden sonra hâlâ yazmaya çalıştığı senaryoları kurmak için.
    duration?: number | ((target: number) => number);
    renders?: { count: number };
  } = {},
) => {
  const { format = plain, duration = 1000, renders } = options;
  const durationOf = (target: number) =>
    typeof duration === "function" ? duration(target) : duration;

  const Counter = ({ value }: { value: number }) => {
    if (renders) renders.count += 1;
    // CalendarView'daki gibi düğüm state'e bağlanıyor: ilk render'da hook
    // `null` görür, ref'in set'lenmesi ikinci render'ı tetikler.
    const [node, setNode] = useState<HTMLSpanElement | null>(null);
    useAnimatedCounter(node, value, format, undefined, durationOf(value));
    // React'in çizdiği içerik ham sayı; formatlı metin yalnızca DOM'a yazılır.
    return <span ref={setNode}>{String(value)}</span>;
  };

  const Harness = () => {
    const [value, setValue] = useState(initialTarget);
    return (
      <div>
        <button onClick={() => setValue(next)}>set</button>
        <Counter value={value} />
      </div>
    );
  };

  const utils = render(<Harness />);
  const span = utils.container.querySelector("span") as HTMLSpanElement;
  // `next` butona basıldığında hedefin alacağı değerdir; render sonrası
  // buton yeniden yorumlanır, bu yüzden güncellenmiş olması gerekir.
  let next = initialTarget;
  const setTarget = (value: number) => {
    next = value;
    act(() => utils.getByText("set").click());
  };
  return { span, utils, setTarget };
};

describe("useAnimatedCounter", () => {
  it("animasyonu tamamlayıp hedef değere ulaşır", () => {
    const { span } = renderCounter(1000);

    act(() => flushFrame(0));
    expect(span.textContent).toBe("0");

    // ease-out cubic: yarı sürede %87,5'e ulaşır.
    act(() => flushFrame(500));
    expect(span.textContent).toBe("875");

    act(() => flushFrame(1000));
    expect(span.textContent).toBe("1000");
    // Hedefe ulaşınca kare planlanmıyor.
    expect(queue.size).toBe(0);
  });

  it("hedef değişince yeni hedef için animasyonu yeniden başlatır", () => {
    const { span, setTarget } = renderCounter(1000);
    act(() => flushFrame(1000));
    expect(span.textContent).toBe("1000");

    // Hedef 2000'e çevrildi: animasyon 1000'den (o anki değer) yeniden başlar.
    setTarget(2000);
    act(() => flushFrame(1500));
    // Süre dolmadan değer hedefte değil; ilerleme kare zamanına göre.
    expect(span.textContent).toBe("1750");
    expect(queue.size).toBe(1);

    act(() => flushFrame(2000));
    expect(span.textContent).toBe("2000");
  });

  it("hedef hızla değişince eski animasyon yeni hedefi ezmez", () => {
    // İlk hedef yavaş (4000 ms), sonrakiler hızlı (200 ms): iptal edilmemiş bir
    // eski animasyon, yeni animasyon BİTTİKTEN SONRA hâlâ yazmaya devam eder.
    const { span, setTarget } = renderCounter(1000, {
      duration: (t) => (t === 1000 ? 4000 : 200),
    });
    act(() => flushFrame(100));

    setTarget(2000);
    act(() => flushFrame(150));
    setTarget(3000);

    // Yeni animasyon 200 ms sürüyor, 150'de başladı → 350'de biter.
    act(() => flushFrame(350));
    expect(span.textContent).toBe("3000");

    // Eski animasyonun süresi 4000 ms: iptal edildiyse artık kare kalmadı.
    act(() => flushFrame(1200));
    expect(span.textContent).toBe("3000");
    expect(queue.size).toBe(0);
  });

  it("format verildiğinde textContent formatlanmış değer içerir", () => {
    const { span } = renderCounter(1234.56, {
      format: (v) => `${v.toFixed(1)} ₺`,
    });

    act(() => flushFrame(1000));
    // Hook kare değerini önce tam sayıya yuvarlar, sonra formatlar.
    expect(span.textContent).toBe("1235.0 ₺");
  });

  it("unmount olunca kare iptal edilir, sonrasında DOM'a yazılmaz", () => {
    const { span, utils } = renderCounter(1000);
    act(() => flushFrame(300));
    const before = span.textContent;
    expect(before).not.toBe("1000");

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    utils.unmount();

    expect(window.cancelAnimationFrame).toHaveBeenCalled();
    // Kuyrukta çalışacak kare kalmadı.
    expect(queue.size).toBe(0);

    act(() => flushFrame(1000));
    expect(span.textContent).toBe(before);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  /**
   * Regresyonin asıl koruması: değer React state'i değil, DOM düğümüdür.
   *
   * Sayaç state ile sürülseydi her karede `setValue` çağrılır ve içinde
   * bulunduğu bileşen (takvimde tüm grid) her karede yeniden çizilirdi.
   * Render sayacı kareler boyunca sabit kalmalı.
   */
  it("animasyon kareleri boyunca yeniden render etmez", () => {
    const renders = { count: 0 };
    renderCounter(1000, { renders });

    // Mount + ref'in bağlanması: iki render. Bundan sonra artmamalı.
    const afterMount = renders.count;
    for (const t of [0, 250, 500, 750, 1000]) act(() => flushFrame(t));
    expect(renders.count).toBe(afterMount);
  });

  it("hedef değişimi kare başına değil, tek seferde render eder", () => {
    const renders = { count: 0 };
    const { setTarget } = renderCounter(1000, { renders });

    setTarget(2000);
    const afterChange = renders.count;

    for (const t of [1000, 1250, 1500, 1750, 2000]) act(() => flushFrame(t));
    expect(renders.count).toBe(afterChange);
  });
});
