# Mimari İyileştirme — PRD

**Status:** needs-triage
**Tarih:** 2026-06-21

## Problem

Kod tabanı büyüdükçe bazı mimari kararlar sürtünme yaratmaya başladı:

- Hesaplama mantığı iki yerde tekrarlanıyor
- AuditLogStore'un revert metodu 200+ satırlık karmaşık bir yapı
- Store'lar hem state hem DB CRUD'u yönetiyor
- Bileşenler çok fazla store'a doğrudan bağımlı
- SQL trigger'ları string literal olarak db.ts içinde

Bu PRD, improve-codebase-architecture analizinde belirlenen 5 adayı kapsar.

## Çözüm

Her aday için ayrı bir issue açılacak. Tüm adaylar birbirinden bağımsız olarak uygulanabilir.

## Kapsam Dışı

- Yeni feature eklenmeyecek
- UI değişmeyecek
- Veritabanı şeması değişmeyecek

## Issue'lar

1. EarningsCalculator — ortak hesaplama modülü
2. Revert Strategy Pattern — AuditLogStore derinleştirme
3. Repository Katmanı — Store'dan DB'yi ayırma
4. Custom Hooks — Component-store bağımlılığını azaltma
5. SQL Trigger'ları ayrı dosyaya taşıma
