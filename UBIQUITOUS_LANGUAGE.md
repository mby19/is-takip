# Ubiquitous Language

## Çalışan Tipleri

| Terim                             | Tanım                                                                                                          | Kaçınılması Gerekenler                 |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| **Çalışan (Worker)**              | Sahada çalışan kişi. İki türü vardır: Ortak ve Günlükçü.                                                       | Personel, işçi, eleman                 |
| **Ortak (ORTAK)**                 | Günlük sabit ücret yerine günlük net kârdan pay alan çalışan. Kâr havuzu ortakların varlık ağırlığına bölünür. | Partner, hissedar, ortak bazlı çalışan |
| **Günlükçü / Yevmiyeli (GUNLUK)** | Sabit günlük ücretle çalışan personel.                                                                         | Saatlik, gündelik, yevmiyeci           |

## Çalışma Durumu

| Terim                         | Tanım                                                                                    | Kaçınılması Gerekenler |
| ----------------------------- | ---------------------------------------------------------------------------------------- | ---------------------- |
| **Devam Durumu (Attendance)** | Bir çalışanın belirli bir tarihteki çalışma durumu.                                      | Yoklama, imza, katılım |
| **Tam Gün (FULL)**            | Çalışanın tüm gün çalıştığı devam durumu.                                                | Mevcut, var            |
| **Yarım Gün (HALF)**          | Çalışanın yarım gün çalıştığı devam durumu.                                              | Eksik gün              |
| **Gelmedi (ABSENT)**          | Çalışanın o gün hiç gelmediği devam durumu.                                              | Devamsız, yok          |
| **Tatil (HOLIDAY)**           | Resmî tatil veya iş tatili günü. Tatil günlerinde üretim ve kazanç hesaplaması yapılmaz. | Bayram, izin           |

## Üretim ve Finans

| Terim                            | Tanım                                                                                                        | Kaçınılması Gerekenler        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **Yevmiye (Daily Wage)**         | Günlükçü bir çalışanın bir tam gün için aldığı sabit ücret.                                                  | Günlük ücret, maaş            |
| **Günlük Metrik (Daily Metric)** | Bir iş gününe ait üretim ve finans verileri.                                                                 | Günlük veri, iş günü kaydı    |
| **Palet**                        | Üretim miktarını ölçen birim.                                                                                | Adet, ürün sayısı             |
| **Toplam Kazanç (Total Earned)** | Bir günde elde edilen brüt kazanç.                                                                           | Hasılat, gelir, ciro          |
| **Ek Gider (Extra Expense)**     | Günlük üretimle ilgili ek harcamalar.                                                                        | Masraf, gider kalemi          |
| **Net Kâr Havuzu**               | Günlük kazançtan giderler ve günlükçü yevmiyeleri düşüldükten sonra ortaklar arasında paylaştırılacak tutar. | Kâr, havuz                    |
| **Ödeme / Avans (Payment)**      | Çalışana yapılan nakdi ödeme.                                                                                | Avans, maaş ödemesi, tahsilat |
| **Bakiye (Balance)**             | Çalışanın toplam kazancından ödemeler düşüldükten sonra kalan net tutar.                                     | Kalan, fark                   |

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
> **Geliştirici:** "**Bakiye** negatif olabilir mi? Yani bir çalışana kazancından fazla avans verilmişse?"
>
> **Alan Uzmanı:** "Evet, **Ödeme** kazancı geçerse **Bakiye** negatif olur. Bu, çalışanın işverene borçlandığı anlamına gelir."

## İşaretlenmiş Belirsizlikler

- **"Yevmiye"** terimi bazen günlük ücret, bazen günlük kazanç anlamında kullanılabiliyor. Bu sözlükte **Yevmiye** sadece **Günlükçü**'lerin sabit ücreti için kullanılır.
- **"Avans"** ve **"Ödeme"** günlük dilde aynı anlamda kullanılıyor. Sistemde ikisi de **Ödeme (Payment)** olarak geçer — avans ayrı bir kavram değildir.
