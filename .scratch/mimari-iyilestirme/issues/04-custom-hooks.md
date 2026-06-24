# 04 — Custom Hooks ile Component-Store Bağımlılığını Azaltma

**Status:** needs-triage
**Priority:** medium
**Related:** CalendarView, WorkerDetailView, DayDetailSheet, AuditLogView

## Problem

Bileşenler ortalama 2.75 store'a doğrudan import ediyor. WorkerDetailView 4 farklı store'a bağımlı. Her bileşende veri yükleme mantığı (useEffect) tekrarlanıyor.

## Çözüm

Custom hook'lar ile veri birleştirme ve yükleme mantığını bileşenlerden ayır:

```typescript
// Örnek
function useWorkerDashboard(workerId: number, month: Date) {
  // içinde workerStore, paymentStore, attendanceStore, metricsStore
  // dışarıya sadece hesaplanmış veri döndürür
  return { stats, payments, isLoading, error };
}
```

## Yapılacaklar

1. `src/hooks/` dizinini oluştur
2. `useWorkerDashboard` hook'unu yaz (WorkerDetailView için)
3. `useDayDetails` hook'unu yaz (DayDetailSheet için)
4. `useMonthlyData` hook'unu yaz (CalendarView için)
5. Bileşenleri hook'ları kullanacak şekilde güncelle
6. Hook'ları renderHook ile test et
