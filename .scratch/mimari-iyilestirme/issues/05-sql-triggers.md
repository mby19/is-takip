# 05 — SQL Trigger Tanımlarını Ayrı Dosyaya Taşıma

**Status:** needs-triage
**Priority:** low
**Related:** src/lib/db.ts (satır 34–79), ADR-0002

## Problem

SQLite CREATE TRIGGER ifadeleri JavaScript string literal'leri olarak `db.ts` içinde gömülü. db.ts'in sorumluluğu DB bağlantısını yönetmek; trigger mantığını barındırmamalı.

## Çözüm

Trigger'ları ayrı bir SQL dosyasına taşı:

```
src/schema/
  ├── triggers.sql
  └── migrations/
```

## Yapılacaklar

1. `src/schema/` dizinini oluştur
2. `triggers.sql` dosyasına tüm trigger'ları taşı
3. `db.ts`'de dosyayı okuyup çalıştıracak mantık ekle
4. Mevcut eski trigger DROP mantığını da SQL dosyasına taşı
