# 02 — Revert Strategy Pattern

**Status:** needs-triage
**Priority:** high
**Related:** src/stores/auditLogStore.ts (revertLog metodu)

## Problem

`revertLog` metodu 200+ satır, iç içe if/else yapısı. Dört tablo (attendance, payments, daily_metrics, workers), üç aksiyon tipi (INSERT, UPDATE, DELETE) ve iki veri formatını tek bir metodun içinde ele alıyor. Interface basit ama implementasyon çok karmaşık — shallow module.

## Çözüm

Strategy pattern: Her tablo için ayrı bir reverter sınıfı/fonksiyonu.

```
revertLog (router)
  ├── AttendanceReverter
  ├── PaymentReverter
  ├── MetricReverter
  └── WorkerReverter
```

## Yapılacaklar

1. `src/reverters/` dizinini oluştur
2. Her tablo için ayrı reverter modülü yaz
3. `revertLog`'u yönlendirici (router) olarak sadeleştir
4. `parseLogData`'yı `src/utils/parseLogData.ts`'ye taşı
5. Her reverter'ın store sync mantığını kendi içinde yönet
6. Test coverage'ını artır
