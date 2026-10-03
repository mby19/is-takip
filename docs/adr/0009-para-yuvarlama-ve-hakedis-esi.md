# ADR-0009: Para Yuvarlama ve Hakediş Eşitliği

**Tarih:** 2026-10-01
**Statü:** Kabul Edildi

## Bağlam

Hakediş hesabında iki ayrı yuvarlama noktası vardı ve ikisi de aynı yanlış
yapıyordu:

- `dailyBreakdown[].earned` **gün gün** `Math.round` ile yuvarlanıyordu.
- Aylık toplam ise **gün gün yuvarlanmamış ham float'ların toplamından**
  `Math.round` ile üretiliyordu.

Sonuç: kullanıcı gün satırlarını topladığında ile ekranda gördüğü toplam
arasında kuruş farkı oluşuyordu. 3 ortak, 100,00 TL kâr senaryosunda ekran
`33,33 × 3 = 99,99` gösterirken toplam `100,00` yazabiliyordu. Bu, sahada
günlük para hareketi olan bir uygulamada kabul edilemez: kişi "günleri
topladım, tutmuyor" diyerek ödeme talep eder.

İkinci sorun **gün kümesiydi**. `calculateWorkerStats` ayın **her günü** için
çağrılıyordu; ay sonu ekranının işletme tarafı ise yalnız `daily_metrics`
satırı olan günler için hesaplıyordu. Puantajı girilmiş ama cirosu
girilmemiş bir gün, kişi dökümünde var (yevmiye ödenir) ama işletme
toplamında yoktu. Dolayısıyla kişi bazlı `totals.due` ile işletme bazlı
`wageCost`/`netProfit` birbirini tutmuyordu.

Üçüncü sorun ölçektir: `resolveWorkerRate` her çağrıda `rateHistory` dizisini
doğrusal tarıyor ve `calculateDailyEarnings` bunu her gün × her çalışan için
çağırıyordu. `indexByDate` ise `calculateWorkerStats`'a her çağrıda yeniden
kuruluyordu — ay sonu ekranı bunu 60 çalışan için ayrı ayrı yapıyordu.

## Karar

### 1. Tek yuvarlama kuralı: kuruş tahsisi (en büyük kalan payı)

Uygulama tam sayı kuruş üzerinden çalışır. `allocateCents()`:

1. Her tutar `floor(tutar × 100)` kuruş tabanına iner.
2. Toplam kuruş `round(Σ ham × 100)` olarak **korunur**.
3. Artan kuruş, **kalan payı (kesir) en büyük** birimlere 1'er kuruş olarak
   dağıtılır; eşitlikte sıra numarası belirleyicidir (deterministik).
4. Sıfır değerli birimler hiçbir zaman kuruş almaz — boş bir gün kuruş
   yutamaz.

Sonuç: **`Σ gün satırı = gösterilen toplam`, her zaman.** Kuruş ne kaybolur
ne yaratılır. Bu kural hem aylık gün satırlarına hem de gün içindeki ortak
havuzu dağıtımına (`calculateDailyEarnings`) ve yevmiyeli ücretlere uygulanır.

Neden bu kural, "toplamı yuvarla, günleri ondan türet" yerine: gün satırı
kullanıcıya **o günün gerçek kazancını** gösterir. Toplamdan türetilen gün
satırları, kuruşu rastgele bir güne yükler ve o günün rakamı gerçeği
yansıtmaz. Kalan-payı tahsisi ise sapmayı en az yapan dağıtımdır.

### 2. Gün kümesi: tek kural, saf fonksiyon

**Hakedişe esas gün:** dönem içinde `daily_metrics` satırı olan **veya** en
az bir puantaj kaydı olan gün.

`earningDaySet(metrics, attendances)` bu kuralın tek uygulamasıdır.
`calculateBusinessTotals` ve `calculateWorkerStats` aynı küreyi kullanır;
böylece kişi toplamları ile işletme toplamları aynı gerçeği anlatır.

### 3. Zarar gününde ortak payı negatif yazılmaz

`netProfit < 0` iken ortakların payı **0** olur. Gerekçe: negatif hakediş,
yevmiyesi düzgün alınan bir çalışana ödenen **gerçek bir borç** yazıyordu;
ortak zarardan sorumlu tutulamaz, zarar işletmenin riskidir.

### 4. Ölçek: indeksli çözümleme ve paylaşılan bağlam

- `buildRateIndex(history)` ücret geçmişini `worker_id` → sıralı kayıtlar
  olarak **bir kez** indeksler. Tarih araması ikili aramayla `O(log n)` olur;
  her gün × her çalışan için doğrusal tarama yapılmaz.
- `createWorkerStatsContext(attendances, metrics, workers, rateHistory)`
  tarih indekslerini, durum haritalarını, gün sonuçlarını ve ortak havuzunu
  kurar ve **önbellekler**. `MonthSummaryScreen` bu tek bağlamı 60 çalışan
  arasında paylaşır.
- `poolFor(worker)` çalışan listedeyse dizinin **kendisini** döndürür (klon
  yok); değilse genişletilmiş havuzu bir kez kurup önbelleğe alır.

`calculateWorkerStats`'ın mevcut konumsal imzası korunmuştur; `context`
parametresi opsiyoneldir. Verilmezse fonksiyon bağlamı kendisi kurar — tek
çağrı için doğru, çok çağrı için yavaş yol budur.

## Etki

- Gün satırlarının toplamı gösterilen toplamla **her zaman** tutuyor — artık
  `calculations.ts` ve `periodStats.ts` **iki ayrı yuvarlama noktasıyla**
  değil, ikisi de `allocateCents` ile aynı diziyi üretiyor.
- Hiçbir senaryoda para kaybolmuyor: ortak olmayan kârlı gün ve zararlı gün
  aynı alanda, aynı işaretle raporlanıyor.
- Zam geçmişi tarama maliyeti ücret kaydı sayısıyla **doğrusal değil**;
  6400 kayıtta ölçülen 43× hızlanma.
- Ay sonu ekranı 80 çalışan için ölçüldü: 10 ms (lineer).

## Sonuçlar

- Ekranlarda yuvarlama farkı göstermeye gerek kalmadı; tek yuvarlama noktası
  `allocateCents` içinde. `periodStats` de bu noktadan geçer.
- `rateResolverFor` tek seferlik kullanım için doğrusal taramada kaldı.
  Gün döngüsü kuran çağıranlar (`CalendarView`, `DayDetailSheet`,
  `MonthSummaryScreen`) `rateResolverFactory(history)` kullanmalıdır; aksi
  hâlde her gün için indeks yeniden kurulur.
- Zararlı günlerde ortak hakedişi negatif yazılmaz.
- Testler: `src/__tests__/earningsRounding.test.ts` (kuruş/gün kümeleri),
  `src/__tests__/periodStats.test.ts` (gün satırı = toplam tutarlılığı).

## İlgili Dosyalar

- `src/utils/earningsCalculator.ts` — `allocateCents`, `roundMoney`,
  `earningDaySet`, `buildRateIndex`, `rateResolverFactory`,
  `calculateDailyEarnings`
- `src/utils/calculations.ts` — `createWorkerStatsContext`,
  `calculateBusinessTotals`, `calculateWorkerStats`
- `src/lib/periodStats.ts` — `calculatePeriodEarnings` (`netProfit`,
  `wageCost` dönem toplamları), `buildWorkerStats`
- `src/__tests__/earningsRounding.test.ts` — kuruş tahsisi ve gün kümeleri
- `src/__tests__/periodStats.test.ts` — dönem gün satırı = dönem toplamı
- `docs/adr/0005-tarih-etkili-ucret-gecmisi.md` — ücret geçmişinin kaynağı

---

## Güncelleme (2026-10-01) — K3: zarar günü ve dağıtılmayan tutar

ADR'lar değiştirilmez; yalnızca not düşülür. Aşağıdaki maddelerin **niteliği**
değişti: madde 3 artık yalnız zarar için geçerli bir kural değil, tek bir
`undistributed` alanına genellenmiş bir değişmez. Kararın çekirdeği — tek
yuvarlama noktası, tek gün kümesi, negatif olmayan ortak payı — geçerlidir.

### Madde 1 — `periodStats` de `allocateCents`'ten geçirildi

Madde 1'in "her zaman" değişmezi denetimde iki ayrı yolda da ihlal ediliyordu:
`periodStats.calculatePeriodEarnings` gün satırlarını `Math.round` ile **tam
liraya** yuvarlıyor, ay toplamını ise ham toplamdan üretiyordu. Aynı veri için
iki yol farklı diziler üretiyordu (`[3000, 3300, 4600]` ↔ `[3000, 3300.18,
4600.37]`). Kuruş eşiğinde çalışan birinde gün satırları 17 + 17 = 34 derken
ekran toplamı 33,34 gösteriyordu. `buildWorkerStats` içindeki dört `Math.round`
de kuruş kaybı yaratıyordu: 1.234,56 TL ödeme ekranda 1.235 TL görünüyordu.

**Güncel hâl:** gün satırları ham tutarlardan `allocateCents` ile üretilir ve
gösterilen toplam bu satırların toplamıdır. Tek yuvarlama noktası değişmedi.

### Madde 2 — `calculateDailyEarnings` gün eşiği uygular

Net kâr ancak günde kayıtlı ekonomik hareket varsa (ciro veya gider girilmişse)
hesaplanır. Puantaj girilmiş ama ciro girilmemiş günde yevmiyeli ücret ödenir,
ortak havuzu ise ne kâr ne zarar görür. Aksi hâlde eksik veri ortaklara
**sahte zarar** yazardı — oysa üretim girişi yapılmamış bir gün zarar günü
değildir.

### Madde 3 — `businessLoss` genelleştirildi: `undistributed`

K3 kararı yalnız _zarar_ için geçerli bir kuraldır; kod onu kâr için de
uyguluyordu. Ortak havuzu **aktif ortak yokken** (`activePartners.length === 0`
— ekipte ortak yok ya da hepsi ABSENT/HOLIDAY) dağıtılmıyordu, ama tutar
**hiçbir alana yazılmıyordu**:

- karışık ekip, ortak ABSENT, ciro 5000 → `netProfit 4000`, `businessLoss 0`,
  `Σ çalışan 1000` → **4000 TL sessizce yok**;
- ekipte hiç ORTAK yok, ciro 10000 / gider 1000 → `net 6800`, dağıtım 2200 →
  **4600 TL sessizce yok**;
- dönem düzeyinde `wage + net − loss = 10000` ama `Σ earned = 2000`.

**Karar: `businessLoss` genelleştirilir ve `undistributed` adını alır.** Tek
alan, tek doğruluk kaynağı — iki ayrı alan aynı sayıyı iki yerden yazacağı
için reddedildi. Alan **işaretlidir ve `netProfit` ile aynı yönde** çalışır:

| Durum                           | `netProfit` | `undistributed` |
| ------------------------------- | ----------- | --------------- |
| Kâr, aktif ortak var, dağıtıldı | `+X`        | `0`             |
| Kâr, **aktif ortak yok**        | `+X`        | `+X`            |
| Zarar, ortak aktif              | `−X`        | `−X`            |
| Zarar, ortak yok                | `−X`        | `−X`            |

Değer **dağıtılan tutarın kendisinden türetilir** (`netProfit − Σ paylar`),
`netProfit`'in işaretinden çıkarılmaz; böylece değişmez yapısal olarak tutar ve
yeni bir dağıtım yolu eklenirse de bozulmaz.

Yevmiyeli (GUNLUK) çalışanların ücreti bu kuraldan **etkilenmez** — sabit
yevmiye her koşulda ödenir; yalnızca kâr havuzundaki ortak payı sıfırlanır.

**Değişmezler (ADR-0009 güncel hâli):**

- `Σ ortak payları + undistributed = netProfit` — gün ve dönem düzeyinde.
- `Σ (tüm çalışan hakedişleri) = totalWorkerCosts + netProfit − undistributed`.
- Kâr gerçekten dağıtılan günde `undistributed = 0` olduğu için bu ikinci
  denklem, eski `Σ çalışan = wageCost + netProfit` kuralıyla aynıdır.

**Görünürlük:** kaybolan para ekranda da görünmezdi. `MonthSummaryScreen` artık
`business.undistributed !== 0` olduğunda «İşletme zararı» / «Dağıtılmayan kâr»
satırını gösterir; `DayDetailSheet` aynı bilgiyi gün bazında gösterir; CSV'de
sütun başlığı «Dağıtılmayan Kâr/Zarar (undistributed)»'dır — yalnız «Zarar»
demek, kâr günü geldiğinde yanlış etiket olurdu.

`allocateCents`'in negatif dalı partner payları için hâlâ **ölü** (partner
payları artık negatif olamaz) ama fonksiyon genel amaçlıdır ve test altındadır;
silinmemiştir.

### Ek — indeksli dönem hakediş yolu (K10)

`periodStats.calculatePeriodEarnings` ve `accumulateAllTimeEarned` hâlâ
`rateResolverFor` kullandığı için dönem dökümü O(gün × çalışan × kayıt) tarıyordu.
Uygulamanın aylık döküm ve "tüm dönemler" ekranları artık
`src/lib/periodEarningsIndexed.ts` katmanını kullanır: aynı hesap, ücret
çözümlemesi önceden kurulmuş indeksten ikili aramayla. Para formülleri
(`calculateDailyEarnings`, `allocateCents`, `roundMoney`) tek kaynaktan gelmeye
devam eder — değişen tek şey çözümleme _biçimidir_. Ölçülen (5 yıl, 60
çalışan, ~6400 ücret kaydı, uçtan uca `accumulate`): lineer 1087 ms ↔ indeksli
53 ms (**20×**), toplamlar birebir aynı. `src/__tests__/periodEarningsIndexed.test.ts`
iki yolu hücre hücre karşılaştırır — hızlandırma bir kuruş değiştiremez.

### Ek — eşlenen testler

- `src/__tests__/undistributed.test.ts` — dağıtılmayan tutar değişmezleri ve
  aktif ortak yok senaryoları
- `src/__tests__/earningsRounding.test.ts` — kuruş tahsisi ve gün kümeleri
- `src/__tests__/periodStats.test.ts` — dönem gün satırı = dönem toplamı
- `src/__tests__/periodEarningsIndexed.test.ts` — indeksli yolun taranan yolla
  birebir aynı olduğunun kanıtı
