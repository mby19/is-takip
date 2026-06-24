# 01 — EarningsCalculator: Ortak Hesaplama Modülü

**Status:** needs-triage
**Priority:** high
**Related:** DayDetailSheet (inline useMemo), utils/calculations.ts

## Problem

Ücret hesaplama mantığı iki yerde tekrarlanıyor:

- `src/utils/calculations.ts` → `calculateWorkerStats()` (aylık breakdown için)
- `src/components/DayDetailSheet.tsx` satır 80–114 → `useMemo` içinde günlük hesaplama

Aynı iş kuralları (günlükçü ücreti, ortak kâr havuzu dağıtımı) iki farklı implementasyonla hesaplanıyor.

## Çözüm

Ortak bir `EarningsCalculator` modülü oluştur. Saf fonksiyonlardan oluşur, store/DB bağımlılığı yoktur.

```typescript
// Önerilen interface
function calculateDailyEarnings(
  workers: Worker[],
  attendances: Attendance[],
  metric: DailyMetric,
): Record<number, number>;

function calculateMonthlyStats(
  worker: Worker,
  month: Date,
  metrics: DailyMetric[],
  attendances: Attendance[],
  workers: Worker[],
  payments: Payment[],
): WorkerStats;
```

## Yapılacaklar

1. `src/utils/earningsCalculator.ts` oluştur
2. `calculateDailyEarnings` fonksiyonunu `DayDetailSheet`'teki inline mantıktan çıkar
3. `calculateMonthlyStats`'i mevcut `calculateWorkerStats`'u referans alarak yaz
4. `DayDetailSheet`'i yeni fonksiyonu kullanacak şekilde güncelle
5. Mevcut testleri (calculations.test.ts) genişlet
6. `DayDetailSheet` içindeki eski mantığı temizle
