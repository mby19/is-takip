# ADR-0001: Store ve Veritabanı Mimarisi

**Tarih:** 2026-06-21
**Statü:** Kabul Edildi — kısmen aşıldı (bkz. Güncelleme, 2026-10-01)

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

---

## Güncelleme (2026-10-01) — "Sonuçlar" maddelerinin aşılması

ADR'lar değiştirilmez; yalnızca not düşülür. Aşağıdaki maddeler artık
geçerli değildir.

- **"Migration yönetimi yoktur; şema değişiklikleri uygulama kodu ile yapılır."**
  → **Aşıldı.** Rust tarafında 13 migration vardır (`src-tauri/src/db.rs`,
  sürüm 1–13), `src-tauri/src/lib.rs` içinde `sqlite:is_takip_v3.db` için
  kayıt altına alınır. Tablo şeması, index'ler ve CHECK constraint'ler
  migration'larla yönetilir.
- **Açılışta idempotent onarım:** `src/lib/schemaGuard.ts` yarıda kalan bir
  migration'ın neden olduğu "no such table" hatalarını açılışta tamamlar.
  Yani şema iki katmanlı yönetilir: migration + JS onarımı.
- **"Testlerde veritabanı mock'lamak gerekir (`fetchQuery` mock'lanmıştır)."**
  → **Aşıldı.** Birim testleri gerçek `node:sqlite` üzerinde çalışır;
  `fetchQuery` mock'lanmaz. Bkz. [ADR-0007](0007-e2e-test-kosumu.md).
- **`fetchQuery` / `executeQuery` çifti tek kanal değildir:** `executeTransaction`
  eklendi (çok ifadeli atomik yazma). Bkz. [ADR-0004](0004-atomik-yazma-ve-yedek-uyumlulugu.md).

Kararın kendisi (Zustand + ham SQLite, repository katmanı) geçerlidir ve
korunuyor.
