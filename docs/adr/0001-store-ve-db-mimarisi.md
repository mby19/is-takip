# ADR-0001: Store ve Veritabanı Mimarisi

**Tarih:** 2026-06-21
**Durum:** Kabul Edildi

## Bağlam

Uygulama yerel bir SQLite veritabanı kullanıyor. Frontend'de React state yönetimi ve veritabanı işlemlerinin nasıl organize edileceği konusunda bir mimari karar gerekiyordu.

Alternatifler:

- **ORM kullanmak** (Drizzle, Kysely) — tip güvenliği sağlar ama Tauri plugin-sql ile uyumluluk sorunu olabilir.
- **Redux / TanStack Query** — state ile veri kaynağını ayrıştırır, ancak lokal SQLite için gereksiz katman.
- **Zustand + ham SQL** — Store'lar hem state'i hem DB işlemlerini yönetir.

## Karar

**Zustand store'ları + ham SQLite sorguları (`@tauri-apps/plugin-sql`) kullanılacak.**

- Her domain entity'si (`workers`, `attendance`, `daily_metrics`, `payments`, `audit_logs`) için ayrı bir Zustand store'u.
- Store metotları state'i günceller ve eşzamanlı olarak SQLite sorgularını çalıştırır.
- Veritabanı bağlantısı tek bir singleton (`getDb()`) üzerinden yönetilir.
- Sorgular `fetchQuery<T>()` ve `executeQuery()` yardımcıları ile çalıştırılır.

## Gerekçe

- **Minimal bağımlılık**: Ek ORM/bridge katmanı yok, Tauri plugin-sql ile doğrudan iletişim.
- **Tek sorumluluk**: Store, bir entity'nin tüm CRUD işlemlerini ve state'ini tek yerde toplar.
- **Optimistic UI**: Store metotları veritabanı cevabını beklemeden local state'i güncelleyebilir.
- **Tip güvenliği**: Ham SQL olsa bile dönüş tipleri generic'lerle yönetilir.

## Sonuçları

- Veritabanı şeması değiştiğinde store'lardaki SQL sorgularının manuel güncellenmesi gerekir.
- Migration yönetimi yoktur; şema değişiklikleri uygulama kodu ile yapılır.
- Testlerde veritabanı mock'lamak gerekir (mevcut testlerde `fetchQuery` mock'lanmıştır).

## Ek: Repository Katmanı (v2, 2026-06-21)

Store'ların doğrudan SQL sorgusu yazması prensibi değişti. Artık:

```
Component → Hook → Store (state) → Repository (CRUD) → lib/db.ts
```

- Her domain entity'si için bir repository (`src/repositories/`) ham SQL sorgularını encapsulate eder.
- Store'lar repository'leri çağırır, artık SQL yazmaz.
- Repository'ler object literal pattern ile yazılır (sınıf değil, Zustand felsefesine uyum).
- Tetikleyiciler `src/schema/triggers.ts` dosyasında tek kaynaktan yönetilir.
- `parseLogData()` gibi yardımcılar `src/utils/` altına taşınmıştır.
- AuditLog revert mantığı Strategy pattern ile `src/stores/revertStrategies.ts`'e ayrıştırılmıştır.

Bu değişiklikle store'lar artık state + orchestration sorumluluğu taşırken, veri erişimi tamamen repository'lere devredilmiştir.
