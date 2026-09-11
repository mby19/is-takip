# ADR-0005: Tarih Etkili Ücret Geçmişi

**Tarih:** 2026-09-11
**Statü:** Kabul Edildi

## Bağlam

`workers.daily_wage` ve `workers.worker_type` tek bir güncel değerdi. Hakediş her
görüntülemede bu değerle yeniden hesaplandığı için:

- Bugün yapılan bir zam, Ocak ayının hakediş dökümünü de değiştiriyordu.
- Bir kişiyi "Günlük"ten "Ortak"a çevirmek geçmiş tüm ayların kâr paylaşımını
  yeniden dağıtıyordu.
- Ödenmiş bir aya ait PDF ile bugün üretilen PDF tutmayabiliyordu.

Bir puantaj/hakediş uygulamasında geçmişin yeniden yazılması kabul edilemez.

## Karar

**`worker_rate_history` tablosu eklendi** (migration 11):

```
worker_id, valid_from (YYYY-MM-DD), daily_wage, worker_type
UNIQUE(worker_id, valid_from)
```

- Hesaplama, günün tarihinde geçerli olan (en büyük `valid_from <= tarih`) kaydı
  kullanır: `resolveWorkerRate()`.
- Kayıt yoksa çalışanın güncel `daily_wage`/`worker_type` değerine düşer. Bu
  sayede tablo boş olsa da davranış bozulmaz.
- Migration, mevcut çalışanlar için `valid_from = '2000-01-01'` açılış kaydı üretir.
- `workers` tablosu **güncel durum** olarak kalır: listeler, yeni gün girişleri ve
  yedekler bu değeri kullanmaya devam eder.

Ücret/tip değiştirildiğinde kullanıcıya "bu tarihten itibaren geçerli" alanı
sorulur (varsayılan: bugün). "Bu ayın başı" ve "Tüm geçmiş" kısayolları vardır;
"Tüm geçmiş" eski davranışı (geçmişi de değiştir) bilinçli olarak seçmeyi sağlar.

## Uyumluluk Notu

Bu, denetimde tespit edilen değişiklikler arasında **eski sürümleri etkileyen
tek** değişikliktir. Eski bir uygulama sürümü `worker_rate_history` tablosunu
görmez ve hakedişi güncel `daily_wage` ile hesaplamaya devam eder; yani aynı
veritabanı üzerinde iki sürüm farklı geçmiş rakamlar gösterebilir.

Yedek biçimi v2 bu tabloyu içerir. v1 yedekleri içe alınırken geçmiş, çalışanların
güncel değerlerinden üretilir — kayıpsız yüklenir.

## Sonuçlar

- Zam sonrası geçmiş aylar eski yevmiyeyle hesaplanmaya devam eder.
- Hakediş formülü tek bir yerde toplandı (`calculateDailyEarnings`); aylık döküm
  bu çekirdeği gün gün çağırır. Önceki iki ayrı uygulama (`calculations.ts` ve
  `earningsCalculator.ts`) sapma riski taşıyordu.
- Testler: `src/__tests__/rateHistory.test.ts`

## İlgili Dosyalar

- `src-tauri/src/db.rs` — migration 11
- `src/repositories/workerRateRepository.ts`
- `src/utils/earningsCalculator.ts` — `resolveWorkerRate`, `rateResolverFor`
- `src/utils/calculations.ts` — aylık döküm
- `src/stores/workerStore.ts` — `updateWorker(..., effectiveFrom)`
