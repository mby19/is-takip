import { useState, useEffect, useRef } from "react";

/**
 * Animates from 0 → target with ease-out cubic deceleration.
 * Replays whenever `target` or `key` changes (pass `key` to force restart).
 */
export function useAnimatedCounter(target: number, key?: string, duration = 1000): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const startTime = performance.now();

    const animate = (now: number) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic: fast start, decelerates toward end
      const eased = 1 - Math.pow(1 - progress, 3);

      setValue(Math.round(target * eased));

      if (progress < 1) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    rafRef.current = requestAnimationFrame(animate);

    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration, key]);

  return value;
}
