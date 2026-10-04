# Ubiquitous Language

## Çalışan Tipleri

| Terim                             | Tanım                                                                                                          | Kaçınılması Gerekenler                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Çalışan (Worker)**              | Sahada çalışan kişi. İki türü vardır: Ortak ve Günlükçü.                                                       | Personel, işçi, eleman                 |
| **Ortak (ORTAK)**                 | Günlük sabit ücret yerine günlük net kârdan pay alan çalışan. Kâr havuzu ortakların varlık ağırlığına bölünür. | Partner, hissedar, ortak bazlı çalışan |
| **Günlükçü / Yevmiyeli (GUNLUK)** | Sabit günlük ücretle çalışan personel.                                                                         | Saatlik, gündelik, yevmiyeci           |

## Çalışma Durumu

| Terim                         | Tanım                                                                | Kaçınılması Gerekenler |
| ----------------------------- | -------------------------------------------------------------------- | ---------------------- |
| **Devam Durumu (Attendance)** | Bir çalışanın belirli bir tarihteki çalışma durumu.                  | Yoklama, imza, katılım |
| **Tam Gün (FULL)**            | Çalışanın tüm gün çalıştığı devam durumu.                            | Mevcut, var            |
| **Yarım Gün (HALF)**          | Çalışanın yarım gün çalıştığı devam durumu.                          | Eksik gün              |
| **Gelmedi (ABSENT)**          | Çalışanın o gün hiç gelmediği devam durumu.                          | Devamsız, yok          |
| **Tatil (HOLIDAY)**           | Eski sistem kaydı; güncel sistemde `ABSENT` (Yok) olarak ele alınır. | Bayram, izin           |

## Üretim ve Finans

| Terim                            | Tanım                                                                                                        | Kaçınılması Gerekenler              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------------- |
| **Yevmiye (Daily Wage)**         | Günlükçü bir çalışanın bir tam gün için aldığı sabit ücret.                                                  | Günlük ücret, maaş                  |
| **Günlük Metrik (Daily Metric)** | Bir iş gününe ait üretim ve finans verileri.                                                                 | Günlük veri, iş günü kaydı          |
| **Üretim / Palet**               | Üretim miktarını ölçen birim.                                                                                | Adet, ürün sayısı                   |
| **Toplam Kazanç (Total Earned)** | Bir günde elde edilen brüt kazanç.                                                                           | Hasılat, gelir, ciro                |
| **Ek Gider (Extra Expense)**     | Günlük üretimle ilgili ek harcamalar.                                                                        | Masraf, gider kalemi                |
| **Net Kâr Havuzu**               | Günlük kazançtan giderler ve günlükçü yevmiyeleri düşüldükten sonra ortaklar arasında paylaştırılacak tutar. | Kâr, havuz                          |
| **Ödeme (Payment)**              | Çalışana yapılan nakdi ödeme. Kesinleşmiş kazançtan düşülerek bakiye hesaplanır.                             | Avans, maaş, tahsilat, ödeme talebi |
| **Bakiye (Balance)**             | Çalışanın toplam kazancından ödemeler düşüldükten sonra kalan net tutar.                                     | Kalan, fark                         |

## Sistem

| Terim                           | Tanım                                                     | Kaçınılması Gerekenler          |
| ------------------------------- | --------------------------------------------------------- | ------------------------------- |
| **Denetim Günlüğü (Audit Log)** | Tüm veri değişikliklerinin otomatik kaydı.                | Log, geçmiş, history, changelog |
| **Soft Delete**                 | Çalışanın veritabanından silinmeyip pasifleştirilmesi.    | Arşivle, sil, pasif et          |
| **Geri Alma (Revert)**          | Denetim günlüğündeki bir kaydın eski haline döndürülmesi. | Undo, rollback, iptal           |

## İlişkiler

- Bir **Çalışan**'ın birden çok **Devam Durumu** kaydı olabilir (her gün için bir kayıt).
- Bir **Çalışan**'ın birden çok **Ödeme** kaydı olabilir.
- Bir **Günlük Metrik** bir takvim gününe aittir.
- **Ortak**'ların kazancı, **Günlükçü** yevmiyeleri düşüldükten sonra kalan **Net Kâr Havuzu**'ndan hesaplanır.
- **Bakiye** = toplam kazanç - toplam ödeme.

## Örnek Diyalog

> **Geliştirici:** "Bir **Ortak** yarım gün çalışırsa kazancı nasıl hesaplanıyor?"
>
> **Alan Uzmanı:** "O günkü **Net Kâr Havuzu**'ndan **varlık ağırlığına** göre pay alır. **Tam Gün** = 1 birim, **Yarım Gün** = 0.5 birim. Havuz, o gün gelen tüm ortakların ağırlıkları toplamına bölünür."
>
> **Geliştirici:** "Peki ya o gün **Ek Gider** varsa?"
>
> **Alan Uzmanı:** "**Toplam Kazanç**'tan önce **Ek Gider**'ler, sonra **Günlükçü** yevmiyeleri düşülür. Kalan **Net Kâr Havuzu** ortaklara dağıtılır. Giderler önceliklidir."
>
> **Geliştirici:** "**Bakiye** negatif olabilir mi? Yani bir çalışana kazancından fazla ödeme yapılmışsa?"
>
> **Alan Uzmanı:** "Evet, **Ödeme** kazancı geçerse **Bakiye** negatif olur. Bu, çalışanın işverene borçlandığı anlamına gelir."

## İşaretlenmiş Belirsizlikler

- **"Yevmiye"** terimi bazen günlük ücret, bazen günlük kazanç anlamında kullanılabiliyor. Bu sözlükte **Yevmiye** sadece **Günlükçü**'lerin sabit ücreti için kullanılır.
- **"Avans"** ve **"Ödeme"** günlük dilde aynı anlamda kullanılıyor. Sistemde ikisi de **Ödeme (Payment)** olarak geçer — avans ayrı bir kavram değildir.

## Kaçınılması Gerekenler — Kod ile Uyumsuzluk (karar kaydı)

Bu bölüm, sözlükte yasaklanan ama kodda **fiilen kullanılan** terimleri kayda geçirir. Kural: **sözlük metin ve arayüz dili içindir, kod içinde değil.** Kod tabanı ilgili yeniden adlandırma dalında yeniden yazılana kadar buradaki isimler okunmalıdır.

| Terim                 | Nerede kullanılıyor                                                                                                                           | Karar                                                                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `partnerShare`        | `src/utils/earningsCalculator.ts` — `DailyEarnings.partnerShare`, yani "bir ortak biriminin payı (oran)".                                     | Kod içinde **kalır**. Alan adı teknik bir hesap terimidir, kullanıcıya hiç gösterilmez. Sözlükteki karşılığı **Net Kâr Havuzu**'dur.                                                        |
| `activePartners`      | `src/utils/earningsCalculator.ts` — o gün gelip varlık ağırlığı > 0 olan ortakların listesi.                                                  | Kod içinde **kalır**. Karşılığı "o gün çalışan ortaklar".                                                                                                                                   |
| `Partner` (İngilizce) | Bu sözlükte yasaklı; kodda büyük harfli `Partner` **yoktur** (yalnız yukarıdaki iki camelCase alan adı).                                      | Yeni kodda **kullanmayın**. Alan adı gerekiyorsa Türkçe karşılığı (`ortak…`) tercih edin.                                                                                                   |
| **Günlük Personel**   | `src/components/WorkerDetailView.tsx` — `GUNLUK` tipindeki çalışan için ekranda gösterilen etiket.                                            | Kod içinde **kalır** ama bu bir **UI metnidir**, terim değil. Sözlük terimi **Günlükçü**'dür. Yeniden adlandırma ayrı, kullanıcıya görünür bir iş değişikliğidir — sessizce yapılmamalıdır. |
| **Avans**             | Sözlükte yasaklı; `CONTEXT.md` ve `README.md` eski sürümlerinde kullanılıyordu. Kod (`payments` tablosu, `paymentStore`) zaten "Ödeme" diyor. | **Ödeme** tek terimdir. Dokümanlardaki "Avans / Ödeme" ikilisi kaldırıldı.                                                                                                                  |
| `Kbf`                 | **Hiçbir yerde bulunmuyor**: ne kodda, ne bu sözlükte, ne dokümanlarda.                                                                       | Kullanımdan kaldırılmış, aykırı bir terimdir. Yanlışlıkla geri gelirse kullanmayın.                                                                                                         |

### Neden yeniden adlandırma bu dala yapılmadı

`partner` → `ortak` yeniden adlandırması kulağa küçük geliyor ama kapsamı geniş:

- `earningsCalculator.ts` içindeki `partnerShare` / `activePartners` alanları ve `DailyEarnings` arayüzü,
- `earningsCalculator.test.ts`, `earningsRounding.test.ts` ve diğer testler,
- bu alanları okuyan bileşenler (`DayDetailSheet`, `WorkerDetailView`, `MonthSummaryScreen` ve öteki ekranlar).

Bu dosyaların tamamı Dalga 2'de düzeltildi. Aynı daldaki düzeltmelerin üstüne geniş bir yeniden adlandırma bindirmek, kırık testleri ve diff gözden geçirmeyi birbirine karıştırır; hataya yol açan en pahalı sınıf hata budur. Karar: **yeniden adlandırma ayrı, kendi dalında** yapılacak.

**Not (infer):** Bu, "alan adlarının UI'a sızmadığı" gözlemine dayanan bir çalışma kararıdır; teknik bir zorunluluk değildir. Yeniden adlandırma istenirse kapsam dışarıda bir iş olarak planlanmalıdır.
