# 03 — Repository Katmanı (Store + DB Ayrıştırması)

**Status:** needs-triage
**Priority:** strong
**Related:** ADR-0001 (güncellenmeli), tüm store'lar, src/lib/db.ts

## Problem

Zustand store'ları iki sorumluluğu birleştiriyor: React state yönetimi + SQLite CRUD. Bu da:

- Test zorluğu (store'u test etmek için DB mock'lamak gerek)
- Ham SQL string'lerinin store'lar arasında dağılması
- Tutarsız hata yönetimi

## Çözüm

Her entity için ayrı repository modülü oluştur:

```
src/repositories/
  ├── workerRepository.ts
  ├── attendanceRepository.ts
  ├── metricsRepository.ts
  └── paymentRepository.ts
```

Store'lar sadece state yönetimi yapar, DB işlemleri için repository'i çağırır.

## Yapılacaklar

1. `src/repositories/` dizinini oluştur
2. Her entity için repository yaz (CRUD + sorgular)
3. Her store'dan SQL sorgularını çıkar, repository çağrısı yap
4. ADR-0001'i güncelle
5. Mevcut testleri repository mock'ları ile çalışacak şekilde güncelle

## ADR Uyarısı

ADR-0001 ("Store ve Veritabanı Mimarisi") bu kararı tersine çeviriyor. Güncellenmeli.
