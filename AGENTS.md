# AGENTS.md — Bu depoda çalışan ajanlar için kurallar

Para uygulamasıdır. Yanlış bir rakam sahada maaş tartışmasına, yanlış bir geri alma
veri kaybına dönüşür. Aşağıdaki kurallar bu yüzden yazıldı; "buradaki gibi yapılıyor"
diye atlanamaz.

## 0. Önce oku

| Dosya                    | Ne için                                                                                                        |
| ------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `CONTEXT.md`             | Alan modeli, tablolar, dosya envanteri, iş kuralları, key patterns. Kod keşfetmeye başlamadan önce burayı oku. |
| `docs/adr/index.md`      | Mimari kararların dizini. Dokunduğun alana karşılık gelen ADR'leri oku.                                        |
| `UBIQUITOUS_LANGUAGE.md` | Terimler. Kodda ve yorumda bu sözlükteki karşılıkları kullan.                                                  |
| `SECURITY_REPORT.md`     | Bilinen açıklar. "Güvenli" varsayma; açık kapıları kapatma.                                                    |

## 1. Kapılar — ne yeşil olmadan ilerlemezsin

### Commit öncesi (`.husky/pre-commit`)

Otomatik ve **atlanamaz**:

```
lint-staged  →  npm run typecheck  →  npm run test
```

- `lint-staged`: değişen `*.ts,tsx,js,jsx` için `prettier --write` + `eslint --fix`;
  değişen `*.json,css,md` için `prettier --write`.
- `npm run typecheck` = `tsc --noEmit` — tüm projeyi tarar, sadece dokunduğun dosyayı değil.
- `npm run test` = `vitest run` — tüm birim testleri.

Bunlardan biri kırıksa **commit etme**. `--no-verify` kullanma; kırık test commit'lenmiş
bir dalda en pahalı hatadır, çünkü sonradan hangi değişikliğin kırdığını bulmak imkânsızlaşır.

### CI (`.github/workflows/ci.yml`)

`main` ve `master` için push ve PR'da beş kapı:

| Job              | Komutlar                                                             |
| ---------------- | -------------------------------------------------------------------- |
| `lint`           | `npm run lint` (eslint src/), `npm run typecheck`                    |
| `test`           | `npx vitest run`                                                     |
| `e2e`            | `cd e2e && npm ci && npx playwright test`                            |
| `build-frontend` | `npm run build` — `lint`+`test`+`e2e` yeşilse                        |
| `build-tauri`    | `npx tauri build` (4 hedef: macOS arm64/x64, Linux x64, Windows x64) |

`build-frontend` ve `build-tauri`, diğer üçüne `needs` ile bağlıdır. Yani yerelde
`npm run build`'i geçen ama e2e'yi geçmeyen bir değişiklik merge edilmez.

### Yerelde elle çalıştır

```bash
npm run typecheck      # tsc --noEmit
npm run lint           # eslint src/
npx vitest run         # birim testleri
npm run build          # tsc && vite build
npm run test:e2e       # = cd e2e && npm run test:e2e
```

## 2. Test konumu ve biçimi

| Tür                      | Yer                        | Notlar                                                                                          |
| ------------------------ | -------------------------- | ----------------------------------------------------------------------------------------------- |
| Birim (saf fonksiyon)    | `src/__tests__/`           | `calculations.test.ts`, `earningsCalculator.test.ts`, `earningsRounding.test.ts`, `sql.test.ts` |
| Birim (store/repository) | `src/__tests__/`           | Gerçek `node:sqlite` üzerinde; `fetchQuery` **mock'lanmaz** (bkz. ADR-0007)                     |
| Bileşen (RTL)            | `src/__tests__/*.test.tsx` | `AppLockOverlay`, `LockSetupWizard`, `DayDetailSheet`, `modalStack`, `navigation`               |
| E2E                      | `e2e/tests/`               | Playwright; Tauri SQL eklentisi fixture ile taklit edilir, SQL gerçek SQLite'ta çalışır         |

Kurallar:

- Bir test dosyası, **var olan davranışı** test eder. Test, kodun bugün olmasını
  istediği şeyi değil, **doğru olan şeyi** test eder; ikisi ayrışırsa önce hangisinin
  doğru olduğuna karar ver.
- Bir test çalışmıyorsa üç seçenek vardır: (a) kaynak kodu düzelt, (b) test eskimişse
  testi **sil**, (c) davranış kasten değişmişse testi yeni davranışa göre yeniden yaz.
  `describe.skip` / `it.skip` ile boşaltmak **kabul edilmez**: yeşil görünen, hiçbir
  şey kontrol etmeyen bir test, testten kötüdür (bkz. ADR-0007'deki aynı gerekçe).
- `it.only` bırakma. Tek bir testi çalıştırmak istiyorsan `.only` yerine dosya
  yolunu ver: `npx vitest run src/__tests__/period.test.ts`.
- Testler deterministik olmalı: tarih/saat bağımlılığı varsa `vi.useFakeTimers()` veya
  açıkça geçilen parametre kullan. Ağ çağrısı, `Math.random()` veya dosya sistemi
  erişimi testi kırılgan yapar.

## 3. Katman kuralı

```
Component → Hook → Store (state + orkestrasyon) → Repository (SQL) → lib/db.ts
```

- **Component** veritabanını bilmez. Veriyi store/hook'tan alır, event yukarı verir.
- **Hook** yalnız React yaşam döngüsü işidir (`useReminders`, `useTimeouts`). Veri yazmaz.
- **Store** state'i tutar ve repository'yi çağırır. **SQL yazmaz.**
- **Repository** SQL'in tek yeridir. State tutmaz, React bilmez.
- `lib/db.ts` bağlantıyı yönetir (`fetchQuery`, `executeQuery`, `executeTransaction`).
  Uygulamanın başka hiçbir yerinden doğrudan `@tauri-apps/plugin-sql` çağrılmaz.

Bu kural ADR-0001'de kararlaştırıldı ve aşılmayan çekirdektir. Katman atlamak
(component'ten doğrudan repository, store'dan SQL) sessizce kırılır ve denetim
günlüğünü ve dönem kilidini deler.

## 4. Hesap katmanı disiplini

Parayla ilgili **her** hesap `src/utils/` altındadır ve saf (React bağımsız) bir
fonksiyondur. Ekranda veya store'da `Math.round`, `* 0.5`, `total - wage` yazma.

**Tek yuvarlama noktası:** `allocateCents()` (`src/utils/earningsCalculator.ts`).
Uygulama tam sayı kuruş üzerinden çalışır; artan kuruş kalan payı en büyük birimlere
dağıtılır. Sonuç: `Σ gün satırı = gösterilen toplam`, her zaman (ADR-0009).

- Ekrana "toplam farklı görünüyor" yaması **ekleme**. Bu, iki yuvarlama noktası
  olduğunun işaretidir; noktayı bul ve kaldır.
- Hesabı değiştiriyorsan `earningsRounding.test.ts` **geçmelidir**. Geçmiyorsa ya
  hesap yanlış ya test eskimiştir — hangisi olduğunu açıkça belirle, tahmin etme.
- Yeni bir para kuralı ekliyorsan **tek yer** değişir: `earningsCalculator.ts` veya
  `calculations.ts`. Aynı formülü ikinci bir yere kopyalama.

## 5. Denetim ve geri alma

Her veri değişikliği `audit_logs`'a düşer ve geri alınabilir olmalıdır.

- **Yeni bir denetlenen tablo** ekliyorsan `src/schema/triggers.ts` içine
  INSERT/UPDATE/DELETE trigger'ı ekle, `DROP_TRIGGERS` dizisine de düşürüşünü ekle ve
  `TRIGGER_SCHEMA_VERSION`'ı bir artır. Bunu atlamak, geçmişte sessiz bir veri
  bozulması yarattı: `worker_rate_history` denetlenmediği için ücret geçmişi
  değişiklikleri geri alınamıyordu (bkz. ADR-0002'deki aşılma notu).
- **Trigger tanımı Rust migration'ına yazılmaz.** Tek kaynak JS tarafıdır (ADR-0003).
- **Geri alma DELETE değil UPSERT yapar** (`revertStrategies.ts`). Denetim kaydı
  geldiğinde ilgili satır silinmiş olabilir.
- **Geri alınan kayıt silinmez**; `audit_logs.reverted_at` ile damgalanır.
- Geri alma mantığını tabloya özel yazacaksan `revertStrategies.ts` içindeki Strategy
  deseni bu yol; `auditLogStore`'a dal kıran `if` yığını ekleme.

## 6. Dosya sahipliği / sahiplenme kuralı

Paralel çalışan birden fazla ajan olabilir.

- Üzerinde çalıştığın dosyaları **önce sahiplen**, sonra düzenle. Aynı dosyaya iki ajan
  yazıyorsa son yazan kazanır ve diğerinin işi kaybolur.
- Bir dosya üzerinde başka bir ajan çalışıyorsa **önce ona ulaş** (`agent://<id>`),
  sonra dokun.
- Başka birinin sahiplediği dosyada **küçük değişiklik** gerekiyorsa dosyayı yeniden
  yazma; o dosyanın sahibine ulaş ve gereken değişikliği ona yaptır.
- Geniş bir refactor'un (rename, taşıma) üzerine başka bir dalın düzeltmelerini
  bindirme. İkisi birleştiğinde diff okunamaz ve hangi adımın neyi kırdığı
  bilinmez. Yeniden adlandırma **ayrı bir iş** olarak planlanır.
- Yalnız markdown/doküman üzerinde çalışıyorsan **kod dosyasına dokunma.**

## 7. Dokümantasyon

- Kod tabanını değiştirdiysen `CONTEXT.md`'yi güncelle: yeni dosya, tablo, sütun,
  export veya komut eklediysen orada karşılığı olmalı. Var olmayan bir şeyi yazma —
  dokümanın test edilmemiş bir iddiası, koddan daha tehlikelidir.
- Mimari bir karar verirsen ADR yaz: `docs/adr/NNNN-kisa-baslik.md`, başlık, tarih,
  statü, bağlam, karar, gerekçe, sonuçlar. Dizine `docs/adr/index.md` içinden ekle.
- **Var olan bir ADR'yi düzenleme.** Karar geçersizleşirse dosyanın sonuna
  "Güncelleme (tarih)" başlıklı bir not düş ve orijinal metni olduğu gibi bırak.
  Kim neyi ne zaman neden değiştirdiği okunabilir kalsın.
- Yeni ADR numarası verirken `docs/adr/` dizinini kontrol et; numara çakışmasın.

## 8. Agent skills

### Issue tracker

Issues and PRDs live in **GitHub Issues**, not in local files. See `docs/agents/issue-tracker.md`.

### Triage labels

Five canonical roles with default label strings. See `docs/agents/triage-labels.md`.

### Domain docs

Single-context repo — one `CONTEXT.md` at the root plus `docs/adr/` for architectural decisions. See `docs/agents/domain.md`.
