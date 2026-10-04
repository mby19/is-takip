# İş Takip — Context

## Domain

Bir inşaat/üretim sahasında çalışan personelin günlük devam durumunu, üretim miktarını ve ödemelerini takip eden uygulama. Hedef platformlar masaüstü (macOS/Windows/Linux) ve mobil (Android/iOS) olup **tek Tauri codebase'i** üzerinden dağıtılır; mobil, ikinci bir uygulama değil aynı uygulamanın ikinci çıktısıdır. Karar: [ADR 0010](docs/adr/0010-mobil-hedefi.md).

### Ubiquitous Language

| Terim                             | Anlamı                                                                                                                                                                             |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Personel / Çalışan (Worker)**   | Sahada çalışan kişi. İki türü vardır: `ORTAK` ve `GUNLUK`.                                                                                                                         |
| **Ortak (ORTAK)**                 | Günlük sabit ücret yerine, günlük net kârdan (toplam kazanç - giderler - günlükçü ücretleri) pay alan çalışan. Kâr havuzu ortakların ağırlıklı varlığına bölünür.                  |
| **Günlükçü / Yevmiyeli (GUNLUK)** | Sabit günlük ücretle (daily_wage) çalışan personel. Tam gün = 1x yevmiye, yarım gün = 0.5x yevmiye.                                                                                |
| **Yevmiye (Daily Wage)**          | Günlükçü bir çalışanın bir tam gün için aldığı sabit ücret.                                                                                                                        |
| **Devam Durumu (Attendance)**     | Bir çalışanın belirli bir tarihteki çalışma durumu: `FULL` (tam gün), `HALF` (yarım gün), `ABSENT` (gelmedi). Eski `HOLIDAY` kayıtları `ABSENT` ile birleştirilmiştir.             |
| **Günlük Metrik (Daily Metric)**  | Bir iş gününe ait üretim miktarı (production_amount), toplam kazanç (total_earned) ve ek giderler (extra_expenses).                                                                |
| **Üretim / Palet**                | Üretim miktarını ölçen birim.                                                                                                                                                      |
| **Ödeme (Payment)**               | Çalışana yapılan nakdi ödeme. Kesinleşmiş kazançtan düşülerek bakiye hesaplanır. Kodda tablo ve alan adı da `payments` / `payment` biçimindedir. "Avans" ayrı bir kavram değildir. |
| **Bakiye (Balance)**              | Çalışanın toplam kazancından yapılan ödemeler düşüldükten sonra kalan net tutar.                                                                                                   |
| **Denetim Günlüğü (Audit Log)**   | Tüm INSERT/UPDATE/DELETE işlemlerinin otomatik kaydı. SQLite trigger'ları ile tutulur. Geri alma (revert) desteği vardır.                                                          |
| **Soft Delete**                   | Çalışanlar veritabanından silinmez, `is_active = 0` yapılarak pasifleştirilir.                                                                                                     |

### İş Kuralları

- **Ortak kazanç hesabı**: Günlük net kazanç = `total_earned - extra_expenses - (günlükçü toplam yevmiye)`. Kalan "havuz" ortaklar arasında varlık ağırlığına (FULL=1, HALF=0.5) bölünür.
- **Günlükçü kazanç hesabı**: `daily_wage × weight` (FULL=1, HALF=0.5).
- **Yazma disiplini (sunucu-gerçeği modeli)**: Bir store yazma yaparken önce veritabanına yazar, sonra veritabanından okuduğu satırı state'e koyar. Tek istisna `attendanceStore` — `markAttendance` / `markAttendanceMany` iyimser (optimistic) güncelleme yapar, yazma başarısız olursa yalnız **etkilenen kayıtları** eski hâline geri alır ve hatayı yukarı fırlatır. Hata yutulmaz; ekranda "kaydedildi" görünen ama kaydedilmemiş veri bırakılmaz.

## Mimari

### Stack

| Katman         | Teknoloji                                                                                                  |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| Uygulama Shell | Tauri v2 (Rust) — masaüstü **ve** mobil hedefler, tek codebase ([ADR 0010](docs/adr/0010-mobil-hedefi.md)) |
| Frontend       | React 19 + TypeScript                                                                                      |
| Styling        | Tailwind CSS v4 + `tailwind-merge` + `class-variance-authority`                                            |
| State          | Zustand v5 (store'lar)                                                                                     |
| DB             | SQLite (`@tauri-apps/plugin-sql`)                                                                          |
| Bildirim       | `@tauri-apps/plugin-notification` (günlük hatırlatma)                                                      |
| Derin bağlantı | `@tauri-apps/plugin-deep-link` (`istakip://bugun` kısayolu)                                                |
| Grafik         | Elle yazılmış SVG (`WorkerDetailView` içinde `<svg viewBox>`) — grafik kütüphanesi yok                     |
| PDF            | jsPDF + jspdf-autotable                                                                                    |
| Tarih          | date-fns (locale: tr)                                                                                      |
| İkon           | Lucide React                                                                                               |
| UI Bileşenleri | Radix UI (Dialog, Sheet, Label, Slot)                                                                      |

### Dizin Yapısı

```
src/
├── __tests__/          # Vitest test dosyaları (setup.ts dahil)
├── components/         # Ekran ve bileşenler
│   ├── ui/             # Radix + CVA ile oluşturulmuş atomik UI bileşenleri
│   ├── CalendarScreen.tsx
│   ├── CalendarView.tsx
│   ├── DayDetailSheet.tsx
│   ├── MonthSummaryScreen.tsx      # Ay sonu özeti (işletme + kişi dökümü)
│   ├── WorkersScreen.tsx
│   ├── WorkerDetailView.tsx         # Kişi detayı + elle çizilen SVG grafik
│   ├── AuditLogView.tsx
│   ├── CsvExportSection.tsx         # Ay sonu/çalışanlar/devam/ölçümler/ödemeler CSV dışa aktarımı
│   ├── EmptyState.tsx               # Boş liste durumu
│   ├── SettingsView.tsx
│   ├── AppLockOverlay.tsx
│   ├── LockSetupWizard.tsx
│   ├── EmojiPatternGrid.tsx         # Uygulama kilidi emoji ızgarası
│   ├── SpinWheelDialog.tsx
│   ├── MonthPickerDialog.tsx
│   ├── PeriodLockSection.tsx
│   ├── BackupSection.tsx
│   ├── ReminderBanner.tsx
│   ├── ReminderSection.tsx
│   ├── ErrorBoundary.tsx
│   ├── ToastContainer.tsx
│   └── modal-stack.tsx              # Dialog/Sheet yığın yönetimi (global geri tuşu)
├── hooks/              # React hook'ları
│   ├── useAnimatedCounter.ts
│   ├── useDomainMonthData.ts         # Ay sonu ekranlarının ortak dönem verisi
│   ├── useReminders.ts               # Bildirim eylemleri + derin bağlantı → bugünü işaretle
│   └── useTimeouts.ts                # Unmount'ta otomatik temizlenen setTimeout kaydı
├── lib/                # Veritabanı, Tauri API, hesap ve sunum katmanı yardımcıları
│   ├── db.ts           # SQLite bağlantısı, fetchQuery/executeQuery/executeTransaction
│   ├── schemaGuard.ts  # Açılışta idempotent şema onarımı
│   ├── sql.ts          # sqlLiteral ve transaction script kurucu
│   ├── tauri.ts        # Tauri API wrapper'ları
│   ├── backup.ts       # JSON yedekleme/geri yükleme (format sürümü 4)
│   ├── period.ts       # Dönem anahtarı (yyyy-MM) yardımcıları
│   ├── periodStats.ts  # Dönem penceresi, indeksler, dönem hakediş toplamı
│   ├── periodEarningsIndexed.ts  # Önceden kurulan ücret indeksinden hakediş
│   ├── attendanceCoverage.ts  # "Bugünün puantajı tamam mı?" ölçütü
│   ├── quickAttendance.ts     # Toplu "hepsi tam gün" kısayolu
│   ├── csvExport.ts    # CSV üretimi (noktalı virgül ayraç + UTF-8 BOM)
│   ├── rateChangeImpact.ts    # Zam etkisi hesabı (onay aralığı)
│   ├── paymentOverpay.ts      # Fazla ödeme tespiti
│   ├── reminder.ts     # Bildirim zamanlama/iptal senkronizasyonu
│   ├── workerReport.ts # Kişi raporu satır modeli
│   ├── pdfFont.ts      # PDF karakter politikası (cp1252 / WinAnsi)
│   ├── errorMonitoring.ts # Sentry kurulumu + PII maskeleme
│   ├── appLock.ts      # Kilit özeti (tuzlu SHA-256) + lockout
│   ├── prefs.ts        # Cihaza özel tercihler (localStorage güvenli erişim)
│   ├── workerAppearance.ts
│   ├── appInfo.ts
│   └── utils.ts        # Genel yardımcılar
├── utils/              # Saf hesap ve biçimlendirme yardımcıları
│   ├── calculations.ts
│   ├── earningsCalculator.ts
│   ├── emojiPattern.ts        # Kilit için emoji ızgarası üretimi/doğrulama
│   ├── turkishCollation.ts    # Türkçe katlama, karşılaştırma, arama
│   ├── auditLogFormat.ts
│   ├── initials.ts
│   └── parseLogData.ts
├── repositories/       # Tüm SQL'in tek yeri
│   ├── workerRepository.ts
│   ├── workerRateRepository.ts     # Tarih etkili ücret geçmişi
│   ├── attendanceRepository.ts
│   ├── metricsRepository.ts
│   ├── paymentRepository.ts
│   ├── closedPeriodRepository.ts   # Kapatılmış dönemler
│   └── auditLogRepository.ts
├── schema/
│   └── triggers.ts     # 15 denetim trigger'ının tek kaynağı (TRIGGER_SCHEMA_VERSION = 3)
├── stores/             # Zustand store'ları
│   ├── attendanceStore.ts
│   ├── auditLogStore.ts
│   ├── metricsStore.ts
│   ├── paymentStore.ts
│   ├── periodStore.ts
│   ├── reminderStore.ts
│   ├── revertStrategies.ts        # Audit geri alma (Strategy pattern)
│   ├── themeStore.ts
│   ├── toastStore.ts
│   └── workerStore.ts
├── types/              # TypeScript tip tanımları
│   ├── index.ts
│   └── jspdf-autotable.d.ts
├── utils/              # Saf hesaplama mantığı (React bağımsız)
│   ├── calculations.ts
│   ├── earningsCalculator.ts      # Kuruş tahsisi, gün kümesi, ücret çözümleme
│   ├── auditLogFormat.ts
│   ├── emojiPattern.ts
│   ├── initials.ts
│   └── parseLogData.ts
├── App.tsx
└── main.tsx
```

### Veritabanı Tabloları

| Tablo                 | Açıklama                                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `workers`             | Çalışanlar (id, name, daily_wage, worker_type: ORTAK/GUNLUK, is_active, created_at, **color**, **short_label**)                      |
| `attendance`          | Günlük devam durumu (id, worker_id, date, status: FULL/HALF/ABSENT/HOLIDAY, UNIQUE(worker_id, date))                                 |
| `daily_metrics`       | Günlük üretim metrikleri (id, date UNIQUE, production_amount, total_earned, extra_expenses, is_holiday)                              |
| `payments`            | Ödemeler (id, worker_id, amount, date, description)                                                                                  |
| `audit_logs`          | Denetim kayıtları (id, action_type, entity_table, record_id, old_data, new_data, created_at, **reverted_at**)                        |
| `worker_rate_history` | Tarih etkili ücret/tip geçmişi (id, worker_id, valid_from, daily_wage, worker_type, created_at, UNIQUE(worker_id, valid_from))       |
| `closed_periods`      | Kapatılmış dönemler (period PK, closed_at, note). Kapatılan dönem salt okunur olur. Detay: [ADR 0006](docs/adr/0006-donem-kilidi.md) |

Şema yönetimi iki katmanlıdır:

- **Rust migration'ları** (`src-tauri/src/db.rs`, 13 adet, sürüm 1–13) tablo şeması, index'ler ve CHECK constraint'leri yönetir.
- **JS onarım katmanı** (`src/lib/schemaGuard.ts`) açılışta eksik parçaları tamamlar. Her adım idempotent'tir ve tek tek başarısız olabilir; sonuç `getSchemaReport()` ile Ayarlar ekranında gösterilir.

Denetim trigger'ları Rust migration'larında **değil**, `src/schema/triggers.ts` içinde tanımlıdır. Detay: [ADR 0003](docs/adr/0003-tetikleyici-yonetimi.md).

### Repository Katmanı

Her veritabanı işlemi bir repository üzerinden yapılır:

| Repository               | Sorumluluk                                     |
| ------------------------ | ---------------------------------------------- |
| `workerRepository`       | Çalışan CRUD + ücret geçmişine kayıt yazma     |
| `workerRateRepository`   | Tarih etkili ücret geçmişi okuma               |
| `attendanceRepository`   | Devam durumu okuma + toplu `upsert` / silme    |
| `metricsRepository`      | Günlük metrik CRUD                             |
| `paymentRepository`      | Ödeme CRUD                                     |
| `closedPeriodRepository` | Kapatılmış dönem okuma / kapatma / açma        |
| `auditLogRepository`     | Denetim kaydı sorguları + geri alma işaretleme |

Store'lar repository'leri çağırır; **tüm SQL repository katmanındadır**. Repository'ler `fetchQuery` (okuma), `executeQuery` (tek yazma) ve `executeTransaction` (çok ifadeli atomik yazma) üzerinden DB'ye erişir.

`attendanceRepository.upsert` / `upsertMany` bilinçli olarak `INSERT OR REPLACE` **kullanmaz**; `INSERT … ON CONFLICT(worker_id, date) DO UPDATE SET status = excluded.status` yazar. `REPLACE`, çakışan satırı silip yeni `id` ile yeniden eklediği için puantaj **değişikliği** bile DELETE+INSERT olarak denetlenir, `attendance_update_log` hiç tetiklenmez ve "Geri Al" puantajı silmek yerine geri yükleyemez.

### State Yönetimi

Her domain entity'si için ayrı bir Zustand store'u var. Store'lar state + repository çağrılarını yönetir:

- `workerStore` — çalışan CRUD
- `attendanceStore` — devam durumu yönetimi
- `metricsStore` — günlük üretim metrikleri
- `paymentStore` — ödeme kaydı
- `auditLogStore` — denetim kaydı görüntüleme + geri alma
- `toastStore` — bildirim mesajları
- `periodStore` — dönem kilidi
- `reminderStore` — günlük hatırlatma ayarı (cihaza özel, localStorage)
- `themeStore` — tema ve palet

### Key Patterns

1. **Katman kuralı**: `Component → Hook → Store (state) → Repository (SQL) → lib/db.ts`. Store asla SQL yazmaz, repository asla state tutmaz, component asla veritabanına gitmez.
2. **Yazma disiplini**: Çoğu store sunucu-gerçeği modelini kullanır (önce DB'ye yaz, sonra okunan satırı state'e koy). İstisna `attendanceStore.markAttendance` / `markAttendanceMany` iyimserdir; yazma başarısız olursa yalnız etkilenen kayıtları eski hâline döndürür ve hatayı **yukarı fırlatır** — hatayı yutmak, kullanıcının kaydedilmemiş veriyi kaydedilmiş sanmasına yol açıyordu.
3. **Dönem kilidi — fail-closed**: Yazma yapan altı yolun tamamı (`workerStore`, `attendanceStore`, `metricsStore`, `paymentStore`, `auditLogStore`, `quickAttendance`) `isDateInClosedPeriod()` üzerinden geçer. Kilit listesi veritabanından okunmamışsa (`closedLoaded === false`) bu fonksiyon **her tarih için `true` döner** — yani hiçbir döneme yazılamaz. Kilit bilinmeyen durumda veri güvenli sayılır. `closed` listesi elle verildiğinde `subscribe` aboneliği `closedLoaded`'ı doğru kabul eder, böylece testler ve yeniden yükleme yanlışlıkla kilitli görünmez. İhlal `ClosedPeriodError` ile bildirilir. Detay: [ADR 0006](docs/adr/0006-donem-kilidi.md).
4. **Denetim kapsamı (JS-managed triggers)**: `src/schema/triggers.ts` **15 trigger** tanımlar — `workers`, `attendance`, `daily_metrics`, `payments` ve **`worker_rate_history`** için INSERT/UPDATE/DELETE. `worker_rate_history` kapsam dışıyken ücret geçmişindeki bir değişiklik geri alınamıyordu: `workers` doğru geri alınsa bile geçmiş satırı yeni ücretle kalıyor ve ekranda 1000 görünürken geçmiş hesap 1500'ten yapılıyordu — sessiz yanlış maaş. Trigger'lar yalnız `PRAGMA user_version` içindeki `TRIGGER_SCHEMA_VERSION` (şu an `3`) değiştiğinde yeniden kurulur, tek transaction içindedir ve hatası yutulmaz (`getTriggerSetupError()` Ayarlar ekranında görünür). Detay: [ADR 0003](docs/adr/0003-tetikleyici-yonetimi.md).
5. **Denetim geri alma (revert) — UPSERT**: `src/stores/revertStrategies.ts` geri almayı tablo bazında Strategy ile yürütür. `attendance` ve `workers` için geri alma **DELETE değil UPSERT** yapar (`INSERT … ON CONFLICT … DO UPDATE`), çünkü denetim kaydı geldiğinde satır silinmiş olabilir. Geri alınan kayıt silinmez; `audit_logs.reverted_at` damgalanır. Böylece "geri alındı" bilgisi denetim tarihçesinde kalır. Detay: [ADR 0002](docs/adr/0002-ikili-denetim-sistemi.md).
6. **Kuruş tahsisi (tek yuvarlama noktası)**: Uygulama tam sayı kuruş üzerinden çalışır. `allocateCents()` her tutarı `floor(x × 100)` tabanına indirir, toplam kuruşu korur ve artanı **kalan payı (kesir) en büyük** birimlere 1'er kuruş dağıtır (eşitlikte sıra belirleyici). Sonuç: `Σ gün satırı = gösterilen toplam`, her zaman. Aynı kural aylık gün satırlarına, gün içi ortak havuzuna ve yevmiyeli ücretlere uygulanır. Ekranlarda "toplam farklı görünüyor" yaması yoktur. Detay: [ADR 0009](docs/adr/0009-para-yuvarlama-ve-hakedis-esi.md).
7. **Gün kümesi ve gün eşiği**: Hakedişe esas gün, dönem içinde `daily_metrics` satırı **veya** en az bir puantaj kaydı olan gündür (`earningDaySet()`); `calculateBusinessTotals` ve `calculateWorkerStats` aynı kümeyi kullanır. Ayrıca net kâr yalnız **günde ekonomik hareket varsa** (ciro veya gider girilmişse) hesaplanır. Puantaj girilip ciro girilmemiş günde yevmiye ödenir, ortak havuzu ne kâr ne zarar görür — aksi hâlde eksik veri ortaklara sahte zarar yazardı. Detay: [ADR 0009](docs/adr/0009-para-yuvarlama-ve-hakedis-esi.md).
8. **Soft Delete**: Çalışanlar `is_active = 0` ile pasifleştirilir, veri bütünlüğü korunur. Denetim trigger'ı `is_active` nullable olduğu için `OLD.x <> NEW.x` yerine `IS NOT` karşılaştırması kullanır; aksi hâlde arşivleme hiç denetlenmezdi.
9. **Single-context veritabanı**: Tüm veri tek bir SQLite dosyasında (`is_takip_v3.db`), WAL modu aktif. `db.ts` kuyruğu **yalnız yazmalarda** aktiftir — okumalar paralel çalışır; kuyruk yalnız havuzun transaction sonrası atılmasını zorunlu kıldığı için yazma gövdelerini seri tutar (`src/lib/db.ts:139-140`).
10. **Puantaj kapsamı**: "Bugünün puantajı girildi mi" ölçütü "bir kayıt var mı" değil "**herkes** için kayıt var mı"dır; arşivlenmiş çalışanlar sayılmaz. 40 kişilik ekipte tek kişi işaretlendiğinde gün dolmuş sayılırsa kalan 39 kişinin puantajı sessizce kaybolur.
11. **Günlük hatırlatma**: Önümüzdeki 14 gün (`DAYS_AHEAD = 14`) tek tek zamanlanır; imza değişmedikçe yeniden kurulmaz, puantajı girilmiş gün atlanır. Zamanlama ve bildirim eylemleri **yalnız mobil platformda** denenir (masaüstünde `command not found` üretiyordu). Derin bağlantı `istakip://bugun` bugünü açar. Detay: [ADR 0008](docs/adr/0008-gunluk-hatirlatma-ve-kisayol.md).
12. **PDF karakter politikası**: Gömülü TTF yok; jsPDF'in yerleşik `helvetica` fontu (cp1252/WinAnsi) kullanılır. cp1252'de karşılığı olmayan `ş Ş ğ Ğ ı İ ₺` okunabilir karşılıklarına eşlenir (`ş`→`s`, `₺`→`TL`); eşlenen karakter varsa belgenin altına `PDF_FONT_WARNING` satırı yazılır. Tutarlar ve tarihler etkilenmez. Detay: `src/lib/pdfFont.ts`.
13. **Mobil hedefi**: Masaüstü ve mobil **tek Tauri codebase'i** üzerinden dağıtılır; ayrı React Native projesi (`is-takip-kontrol`) terk edildi. Para hesabı, denetim trigger'ları ve geri alma ikinci kez yazılmaz. Capability dosyasında `platforms` anahtarı **yoktur** — tek dosya tüm platformlara uygulanır. Yedeklemede `BaseDirectory.Download` Android'de uygulamaya özel `Android/data/<paket>/files/Download` altıdır (dosya yöneticisinden görünmez), bu yüzden mobilde kurtarma yolu `saveFileWithPicker` (SAF) üzerinden `dialog:allow-save` ile yürür. Detay: [ADR 0010](docs/adr/0010-mobil-hedefi.md).
