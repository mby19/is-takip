# Mimari Karar Kayıtları (ADR) Dizini

Her ADR, tek bir mimari kararı ve gerekçesini kalıcılaştırır. ADR **değiştirilmez**;
bir karar geçersizleşirse dosyanın sonuna **"Güncelleme"** başlıklı bir not düşülür ve
orijinal metin olduğu gibi bırakılır.

Alan modeli, tablo ve dosya envanteri için [CONTEXT.md](../../CONTEXT.md) dosyasına bakın.

## Dizin

| ADR                                              | Başlık                                                     | Tarih      | Durum                            | Tek satır özet                                                                                                                                                                  |
| ------------------------------------------------ | ---------------------------------------------------------- | ---------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [0001](0001-store-ve-db-mimarisi.md)             | Store ve Veritabanı Mimarisi                               | 2026-06-21 | Kabul Edildi — **kısmen aşıldı** | Zustand store'ları + ham SQLite, SQL tamamen repository katmanında. Migration yoktu varsayımı aşıldı: 13 Rust migration ve `schemaGuard.ts` onarım katmanı var.                 |
| [0002](0002-ikili-denetim-sistemi.md)            | İkili Denetim Sistemi (Dual-Safety Audit)                  | 2026-06-21 | Kabul Edildi — **kısmen aşıldı** | Trigger + uygulama katmanı ikilisi korunur; denetim kapsamı `payments`'ten 5 tabloya (15 trigger) genişledi, "temiz revert = kayıt silinir" yerine `reverted_at` damgası geldi. |
| [0003](0003-tetikleyici-yonetimi.md)             | Tetikleyici (Trigger) Yönetimi                             | 2026-06-24 | Kabul Edildi — **kısmen aşıldı** | Tetikleyicilerin tek kaynağı `src/schema/triggers.ts`. Rust migration'ları yalnız tablo/index yönetiyor varsayımı, `schemaGuard.ts` ile tamamlandı.                             |
| [0004](0004-atomik-yazma-ve-yedek-uyumlulugu.md) | Atomik Yazma ve Yedek Sürüm Uyumluluğu                     | 2026-09-11 | Kabul Edildi                     | Çok adımlı yazmalar tek `execute` çağrısında `BEGIN IMMEDIATE … COMMIT` ile gider; yedek formatı sürümlüdür ve geri yükleme tek transaction'dır.                                |
| [0005](0005-tarih-etkili-ucret-gecmisi.md)       | Tarih Etkili Ücret Geçmişi                                 | 2026-09-11 | Kabul Edildi                     | Zam bugünü değiştirir, geçmişi değil: `worker_rate_history` tablosu ile hakediş tarihe göre çözülür.                                                                            |
| [0006](0006-donem-kilidi.md)                     | Dönem Kilidi                                               | 2026-09-11 | Kabul Edildi                     | Ödemesi yapılmış dönem `closed_periods` ile salt okunur olur; kilit listesi yüklenemezse uygulama fail-closed davranır.                                                         |
| [0007](0007-e2e-test-kosumu.md)                  | Uçtan Uca Testlerin Gerçek SQLite ile Koşulması            | 2026-09-11 | Kabul Edildi                     | Playwright testlerinde Tauri SQL eklentisi taklit edilir, SQL gerçek SQLite'ta çalışır; koşmayan test yazılmaz.                                                                 |
| [0008](0008-gunluk-hatirlatma-ve-kisayol.md)     | Günlük Hatırlatma, Bildirim Eylemleri ve Uygulama Kısayolu | 2026-09-12 | Kabul Edildi                     | Önümüzdeki 14 gün ayrı ayrı zamanlanır; bildirimden toplu işaretleme ve `istakip://bugun` kısayolu.                                                                             |
| [0009](0009-para-yuvarlama-ve-hakedis-esi.md)    | Para Yuvarlama ve Hakediş Eşitliği                         | 2026-10-01 | Kabul Edildi                     | Kuruş tahsisi tek yuvarlama noktasıdır: `Σ gün satırı = toplam`, her zaman. Gün kümesi ve gün eşiği kuralı da burada tanımlandı.                                                |
| [0010](0010-mobil-hedefi.md)                     | Mobil Hedefi: Tauri Mobil Yolu                             | 2026-10-02 | Kabul Edildi                     | Mobil, ayrı React Native projesiyle değil aynı Tauri uygulamasının mobil hedefleriyle açılır; para hesabı ve denetim mantığı ikinci kez yazılmaz.                               |

## Durum okuması

- **Kabul Edildi** — karar yürürlükte, ek not yok.
- **Kabul Edildi — kısmen aşıldı** — kararın çekirdeği geçerli, ancak bir veya daha fazla
  ifadesi artık doğru değil. Dosyanın sonundaki "Güncelleme" bölümü neyin değiştiğini
  ve neyin neden geçerli kaldığını yazar.

Durum alanı iki biçimde yazılır ve ikisi de aynı anlama gelir: dosyanın
başlığındaki `**Statü:**` satırı ve buradaki tablo. Kararın gövdesi
değişmediği sürece ikisi de eşleşir.

## Okuma sırası

Yeni katılan biri için öneri:

1. [0001](0001-store-ve-db-mimarisi.md) — katman kuralı (`Component → Hook → Store → Repository → lib/db.ts`)
2. [0003](0003-tetikleyici-yonetimi.md) — denetim kaydı nasıl tutulur
3. [0002](0002-ikili-denetim-sistemi.md) — geri alma nasıl çalışır
4. [0005](0005-tarih-etkili-ucret-gecmisi.md) ve [0006](0006-donem-kilidi.md) — geçmiş neden değiştirilemez
5. [0009](0009-para-yuvarlama-ve-hakedis-esi.md) — para hesabının tek doğru yolu
6. [0004](0004-atomik-yazma-ve-yedek-uyumlulugu.md), [0007](0007-e2e-test-kosumu.md), [0008](0008-gunluk-hatirlatma-ve-kisayol.md) — yazma güvenliği, testler, hatırlatma
7. [0010](0010-mobil-hedefi.md) — neden tek codebase (masaüstü + mobil) ve React Native yolu neden terk edildi
