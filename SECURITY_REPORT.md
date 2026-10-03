# 🔒 İş Takip — Güvenlik Değerlendirmesi (kamuya açık sürüm)

**Uygulama:** is-takip v0.1.0 (Tauri v2 + React 19 + SQLite)
**İlk denetim:** 3 Temmuz 2026
**Bu sürüm:** 2 Ekim 2026

---

## Bu belgeyi nasıl okuyun

Bu belge, uygulamanın veri güvenliği konusundaki **bilinen sınırları** açıkça
listeler. Amacı iki şeydir:

1. **Kullanıcıyı bilgilendirmek** — bu uygulamayı hangi tehditlere karşı
   kullandığınızı bilin.
2. **Kullanıcıya yol göstermek** — her bulgu için ne yapması gerektiğini söylemek.

Bu belge **bir saldırı kılavuzu değildir.** Zayıf noktaların _ne_ olduğu ve
_neden_ zayıf oldukları açıkça yazılmıştır; ancak hiçbir zayıf noktanın
**nasıl istismar edileceğine dair adım adım talimat verilmemiştir.** Kilit,
tuz veya dosya konumlarını kullanarak korumayı aşma prosedürleri bilinçli olarak
bu belgeden çıkarıldı.

Bulguların her biri üç soruya cevap verir: **Durum**, **Etki** ve
**Kullanıcıya ne yapması gerekiyor**.

### Durum işaretleri

| İşaret | Anlamı                                                       |
| ------ | ------------------------------------------------------------ |
| ✅     | Çözüldü. Düzeltme kodda ve sürüm kontrolündedir.             |
| 🔶     | Açık. Bilinen ve kabul edilmiş bir eksi.                     |
| ⛔     | Kabul edilen sınır. Bu dalda çözülemez; tasarımın doğasıdır. |

### Bilinçli bir karar: bu belgenin yayımlanması

Bu belge, uygulamanın sınırlarını gizlemek yerine **ilan etmeyi** seçer. Bunun
gerekçesi şudur: istemci tarafı bir kilidin sınırı, uygulamayı kullananın onu
**bilmemesi** değildir — kodu okuyabilen biri zaten sınırları görür. Gizlilik,
güvenlik sağlamaz; yalnızca kullanıcıyı **yanlış bir güvenlik hissi**yle baş başa
bırakır. Bu belge o yanılgıyı kaldırmak için var.

Bununla birlikte, bu belgenin public depoda durması bir **karar**dır ve
[bölüm sonundaki seçenekler](#bu-belgeyi-yayımlamak-mı-silmek-mi) kısmında
iki seçenek artı/eksileriyle karşınıza bırakılmıştır.

---

## 📋 Durum özeti

| #   | Önem      | Bulgu                                                   | Durum                           | Tarih       |
| --- | --------- | ------------------------------------------------------- | ------------------------------- | ----------- |
| 1   | 🔴 Yüksek | Uygulama kilidi istemci tarafında                       | 🔶 Azaltıldı, kaldırılmadı      | 1 Ekim 2026 |
| 2   | 🟠 Orta   | Kaba kuvvete karşı hız sınırlaması yoktu                | ✅ Çözüldü (kısmi)              | 1 Ekim 2026 |
| 3   | 🟡 Orta   | Kurtarma PIN'i kilidi kalıcı olarak kaldırıyor          | 🔶 Hâlâ açık                    | —           |
| 4   | 🟢 Düşük  | Denetim günlüğünde hassas veri düz metin                | ⛔ Bilinçli kabul               | —           |
| 5   | 🔴 Yüksek | Hata izleme ile kişisel veri sızıntısı riski            | ✅ Çözüldü                      | 1 Ekim 2026 |
| 6   | 🔴 Kritik | Veritabanı diske şifresiz yazılıyor                     | ⛔ Kabul edilen sınır           | 1 Ekim 2026 |
| 7   | 🟠 Yüksek | Yedek dosyaları şifresiz diske yazılıyor                | 🔶 Hâlâ açık                    | 1 Ekim 2026 |
| 8   | 🟠 Yüksek | Kilit ekranı açıkken uygulama arayüzü bellekte oluşuyor | 🔶 Hâlâ açık (kısmi hafifletme) | 1 Ekim 2026 |
| 9   | 🟡 Orta   | Android'de uygulama verisi cihaz yedeğine giriyordu     | ✅ Çözüldü                      | 2 Ekim 2026 |
| 10  | 🟠 Yüksek | iOS'ta uygulama verisi cihaz yedeğine giriyor           | ⛔ Kabul edilen sınır           | 2 Ekim 2026 |

---

# 1 · 🔴 Yüksek: Uygulama Kilidi İstemci Tarafında

**Durum: 🔶 Azaltıldı, kaldırılmadı — 1 Ekim 2026**

### Bu ne demek

Uygulamanın kilidi, cihazda saklanan bir "kilit açık / kapalı" bilgisine bakar ve
kararı **uygulamanın kendi içinde** verir. Veritabanı yalnızca kilit açıldıktan
sonra okunur; ama kilit açıldıktan sonra veritabanı **şifresiz** olarak durur
(Bulgu 6).

2026-07-03 denetiminde kilit bilgileri düz metin saklanıyordu. Düzeltilmiş
hâli şu:

- Desen ve PIN artık **düz metin olarak tutulmuyor**; her ikisi de cihazda üretilen
  bir tuzla karıştırılıp SHA-256 özetine çevrilerek saklanıyor.
- Tuz `crypto.getRandomValues` ile 16 bayt üretiliyor.
- Eski düz metin kayıtlar, kurulum bir sonraki açılışta kendiliğinden özete
  çevrilip siliniyor.

**Önemli olan ne kazanıldı:** Kimlik bilgisi artık ekrana bakıp okunamıyor ve
deneme sınırı var.

**Önemli olan ne kazanılmadı:** Tuz da aynı yerde, aynı dosyada, şifresiz duruyor.
Yani bu bir "gizli anahtar" değil, **karıştırma (obfuscation) seviyesinde** bir
koruma. Ayrıca SHA-256 kasıtlı olarak hızlı bir algoritmadır; dört haneli bir PIN'in
olasılık uzayı küçüktür ve bu özet, **cihaz dışından yapılan kaba kuvveti
yavaşlatır, durdurmaz.** Uygulama kodundaki yorum da aynısını söyler.

### Etki

| Metrik          | Değer                                       |
| --------------- | ------------------------------------------- |
| Saldırı vektörü | Cihaza fiziksel erişim                      |
| Gereken yetki   | Düşük — dosya sistemi okuma yetkisi yeterli |
| Gizlilik        | Yüksek — tüm finansal veri şifresiz duruyor |
| Bütünlük        | Yüksek — veri doğrudan düzenlenebilir       |

### Kullanıcıya ne yapması gerekiyor

1. **Kilit bir giriş perdesidir, kasa değildir.** Amacı; iş arkadaşınız, aileniz
   ya da ziyaretçiniz açık masadaki telefonunuza bakıp ekranı okuduğunda veriyi
   görmemesidir. Cihazınıza fiziksel ve dosya sistemi erişimi olan birine karşı
   koruma sağlamaz.
2. **Asıl koruma cihazın kendi disk şifrelemesidir** (Bulgu 6). FileVault,
   BitLocker veya LUKS açık değilse kilidin anlamı belirgin biçimde azalır.
3. **PIN'i tahmin edilemez seçin.** Uygulama 4 haneli PIN kullanır ve bu uzunluk
   değiştirilemez; 1234, 0000, doğum yılı gibi PIN'ler milisaniyeler içinde
   denenecek türdendir. Mümkün olan en az tahmin edilebilir dört haneyi seçin.
4. **Deseni de gözle okunamayacak kadar belirgin yapmayın** — üç emoji'nin
   olasılık uzayı dört haneli PIN'den büyük değildir.
5. **PIN'i not edin.** PIN'i unutmak kilidi kalıcı olarak kaldırır (Bulgu 3) ve
   veriniz kilitsiz kalır.

---

# 2 · 🟠 Orta: Kaba Kuvvete Karşı Hız Sınırlaması Yoktu

**Durum: ✅ Çözüldü (kısmi) — 1 Ekim 2026**

### Bu ne demek

Doğrulama denemeleri sınırsızdı; kilitli bir cihazda denklemler sonsuza kadar
denenebilirdi.

Eklenen önlem (`src/lib/appLock.ts`):

| Parametre             | Değer     |
| --------------------- | --------- |
| Maksimum deneme       | 5         |
| Kilit süresi          | 60 saniye |
| Sayaç sıfırlanıyor mu | Hayır     |

Uygulama kilitliyken hiçbir karşılaştırma yapmadan reddeder; kalan süreyi ve
kalan deneme hakkını kullanıcıya gösterir.

### Kalan sınır

Bu sayaç da uygulamanın kendi depoda tutuluyor. Dolayısıyla **uygulama içi**
sayacı sıfırlanabilir — ama aynı işlem kilit bilgisini de etkiler ve sonuç,
"Bulgu 1'in sınırı"dır: ayrı bir açık değil, aynı gerçeğin yansıması.
Kilit dışından gelen kaba kuvveti durduran şey bu sayaç değildir.

### Kullanıcıya ne yapması gerekiyor

1. Uygulama kilidini bir güvenlik sınırı olarak değil, bir gizlilik önlemi olarak
   değerlendirin.
2. 5 deneme / 60 saniye kuralına güvenerek PIN'i "zayıf" seçmeyin — bu sayaç
   yalnızca **uygulama içindeki** denemeleri yavaşlatır.

---

# 3 · 🟡 Orta: Kurtarma PIN'i Kilidi Kalıcı Olarak Kaldırıyor

**Durum: 🔶 Hâlâ açık**

### Bu ne demek

Deseni unuttunuzda uygulamanın istediği kurtarma PIN'ini girdiğinizde kilit
**silinir** — sadece bir kez atlanmaz, kalıcı olarak kalkar ve kendiliğinden geri
gelmez. Yeniden kurulum eski PIN'i bilmeyi gerektirir, ki o da unutulmuş olabilir.

Kurtarma PIN'i de 4 hanelidir ve kilit durumunu cihazda saklandığı için bu yol,
Bulgu 1'in sınırının doğrudan bir yüzüdür: **teknik bilgisi olmayan biri bile
kilitli bir uygulamayı kalıcı olarak kilitsiz bırakabilir.**

### Etki

Veri kaybı yoktur; koruma kaybı vardır. Kullanıcı farkında olmadan uygulama
süresince kilitsiz kalır ve gizlilik perdesi kaybolur.

### Kullanıcıya ne yapması gerekiyor

1. **Kurtarma PIN'ini PIN'inizden farklı seçin** ve ikisini de not edin.
2. Kilitli uygulamayı açık bırakmayın; uygulama arka plana alındığında kendiliğinden
   kilitlenir — masanızda açık bir bırakılan cihazda perdesiz kalırsınız.
3. **Kurtarma PIN'ini kaybederseniz** uygulama kilidini sıfırlamanın tek yolu bu
   olduğundan, verinizi şifreli yedeklerle koruyun (Bulgu 7).

---

# 4 · 🟢 Düşük: Denetim Günlüğünde Hassas Veri Düz Metin

**Durum: ⛔ Bilinçli olarak kabul edildi**

### Bu ne demek

Uygulamadaki her değişiklik, veritabanı içindeki denetim tablosuna düz metin
JSON olarak yazılır: personel adı, tutar, tarih, açıklama, ücret geçmişi.

### Neden kabul edildi

Denetim kaydı **geri alma için zorunludur.** Kayıttan veri çıkarılırsa bir
yanlış kayıt geri alınamaz ve veri bütünlüğü bozulur. Bu, formülleştirilebilir
bir "eşleştirme" ihtiyacıdır; şifrelemek geri almayı imkânsız hale getirir.
Denetim günlüğünü yedeklemeden çıkarmak da bir çözüm değildir — aynı sorun
Bulgu 6 ve Bulgu 7'de toplu olarak ele alınır.

### Kullanıcıya ne yapması gerekiyor

1. Denetim günlüğünü bir "gizlilik ayarı" gibi kapatmayı beklemeyin; kapatma
   seçeneği **yoktur** ve bu bilinçli bir tasarım kararıdır.
2. Veritabanı dosyasını paylaşıyorsanız (destek, taşınma, cihaz değişimi),
   denetim günlüğünün de maaş verisi taşıdığını unutmayın.
3. Asıl koruma yine cihaz şifrelemesi ve yedeklerin güvenli saklanmasıdır.

---

# 5 · 🔴 Yüksek: Hata İzleme ile Kişisel Veri Sızıntısı Riski

**Durum: ✅ Çözüldü — 1 Ekim 2026**

### Bu ne demek

Uygulama, isteğe bağlı olarak hata izleme (Sentry) kullanır. Personel detay
ekranında ad, yevmiye, ödeme tutarı ve bakiye görünür. Hata izleme ekran
kaydı (session replay) varsayılan ayarlarla bu metni toplayıp **üçüncü taraf bir
sunucuya gönderebilirdi** — yani maaş verisi, uygulamayı kullanan kişinin
farkında olmadan uygulamanın geliştiricisine giderdi.

### Nasıl çözüldü

`src/lib/errorMonitoring.ts` içinde beş önlem birlikte uygulandı:

| Önlem                                    | Değer                         |
| ---------------------------------------- | ----------------------------- |
| Ekran metninin tamamı maskeli            | `maskAllText: true`           |
| Görsel/görüntü hiç gönderilmiyor         | `blockAllMedia: true`         |
| IP ve header otomatik gönderimi kapalı   | `sendDefaultPii: false`       |
| Hata olmayan oturumlarda kayıt alınmıyor | `replaysSessionSampleRate: 0` |
| Diğer kanallar ikinci savunma hattı      | `beforeSend` + `maskEvent()`  |

`maskEvent()` ayrıca para tutarlarını, T.C. kimlik numarası biçimindeki
11 haneli sayıları, IBAN'ları ve telefon numaralarını maskeler.

### Ek önlem — en önemlisi bu

Sentry **yalnızca** `VITE_SENTRY_DSN` ortam değişkeni tanımlıysa etkinleşir.
DSN verilmemişse Sentry paketi hiç yüklenmez. Yani hata izleme, **bilerek açan**
kurulumları ilgilendirir; varsayılan olarak kapalıdır.

### Kullanıcıya ne yapması gerekiyor

1. Hata izlemeyi kendiniz etkinleştirmiyorsanız veriniz cihazınızdan çıkmaz.
   Buna güvenebilirsiniz.
2. **Hata izlemeyi açmayı düşünüyorsanız**, önce unutmayın: uygulama maaş
   verisi işleyen bir uygulamadır. Hata izleme, verinin işlendiği bir kurumsal
   ortamda ek onay gerektirebilir.
3. **Bir hata raporunda ad, tutar veya IBAN görüyorsanız** bunu bir bulgu olarak
   bildirin (bkz. [SECURITY.md](SECURITY.md)) — maskeleme kaçırılmış demektir ve
   düzeltilmesi gerekir.

---

# 6 · 🔴 Kritik: Veritabanı Diske Şifresiz Yazılıyor

**Durum: ⛔ Kabul edilen sınır — bu dalda çözülemez (1 Ekim 2026)**

### Bu ne demek

Tüm veri — personelin adı, yevmiyesi, ücreti, ödemeleri, cirosu, giderleri,
denetim günlüğü — tek bir SQLite dosyasında **şifresiz** durur. Uygulama
kilidi, veriyi diske yazarken hiçbir şifreleme yapmaz.

Bu, bir eksik özellik değil; **tasarımın doğasıdır.** Veriyi şifrelemek için bir
anahtar gerekir; bu anahtar uygulamanın belleğinde yaşamak zorundadır; uygulamaya
erişebilen biri anahtarı da okur. Kilitliyken veritabanını hiç açmamak, kullanıcıya
hiçbir işlev sunmaz.

### Etki

| Metrik          | Değer                                       |
| --------------- | ------------------------------------------- |
| Saldırı vektörü | Fiziksel erişim                             |
| Gereken yetki   | Düşük — dosya sistemi okuma yetkisi yeterli |
| Gizlilik        | Yüksek — tüm finansal veri şifresiz         |
| Bütünlük        | Yüksek — veri doğrudan düzenlenebilir       |

### Gerçekçi sınır

Bu uygulama, **teknik bilgisi olmayan ama fiziksel erişimi olan** birine karşı
koruma sağlar: iş arkadaşı, aile üyesi, ziyaretçi. Cihazı açıp dosya sistemiyle
uğraşan birini engellemez ve bunu iddia etmez.

### Gerçek azaltım yolları (uygulama içinden değil, cihazdan)

| Önlem                                 | Nerede                                                 |
| ------------------------------------- | ------------------------------------------------------ |
| Tam disk şifreleme                    | FileVault (macOS) / BitLocker (Windows) / LUKS (Linux) |
| İşletim sistemi parolası              | Oturum açılmadan veri okunamaz                         |
| Güçlü cihaz parolası + otomatik kilit | Kısa süre hareketsizlikte kilitlenir                   |
| Mobilde işletim sistemi şifrelemesi   | Android/iOS'ta varsayılan olarak açıktır               |

### Kullanıcıya ne yapması gerekiyor

1. **Cihazınızın tam disk şifrelemesini açın.** Bu uygulamadaki en yüksek
   etkili tek adımdır. macOS'te FileVault, Windows'ta BitLocker, Linux'ta LUKS.
2. **Cihazınızı şifreli açık bırakmayın.** Kısa otomatik kilit süresi ayarlayın.
3. **Diskteki veritabanı dosyasını yedeklemeyin, kopyalamayın.** Disk
   şifrelemesi, kopyanın taşındığı her yerde de geçerlidir.
4. **Bu sınırı bilerek kabul edin.** Uygulama şifreli bir veritabanı vaat etmez;
   bu vaat yalnızca cihazınızın şifrelemesiyle yerine gelir.
5. Kurulum talimatlarında ve ekip içi kullanımda bu sınırı **açıkça yazın** —
   ekibinizin maaş verisini bu cihazda tuttuğunu fark etmeleri gerekir.

---

# 7 · 🟠 Yüksek: Yedek Dosyaları Şifresiz Diske Yazılıyor

**Durum: 🔶 Hâlâ açık (1 Ekim 2026)**

### Bu ne demek

"Yedek al" dediğinizde uygulama, tüm verinin **düz metin JSON kopyasını**
bilgisayarınıza yazar. Bu dosyanın hiçbir şifrelemesi veya parola koruması yoktur.

İki ayrı risk var:

1. **Yedek dosyası uygulama kilidinden bağımsızdır.** Uygulama kilitliyken bile
   bu dosya okunabilir bir metindir.
2. **Geri yükleme öncesi otomatik güvenlik yedeği** aynı diske ikinci bir şifresiz
   kopya yazar.

Saha kullanımında yedek dosyasını USB belleğe atıp eve götürmek olağandır; o
andan itibaren dosya cihaz yedeğine, bulut senkronizasyonuna veya paylaşılan bir
klasöre girebilir.

### Kullanıcıya ne yapması gerekiyor

1. **Yedek dosyasını şifreli bir konumda saklayın:** şifreli disk bölümü,
   şifreli arşiv (örneğin parola korumalı ZIP/7z), ya da işletim sisteminizin
   şifreli bulut klasörü. Düz bir klasöre kopyalamayın.
2. **Yedek dosyasını USB'den işten eve taşırsanız**, taşıdıktan sonra belleği
   biçimlendirin veya güvenli silin.
3. **Yedekten söz etmeyin ama sızdırmayın.** "Maaş dökümü" içeren bir yedek dosyası,
   işten alınabilir bir belge değildir; kişisel veri ve saklama yükümlülüğü doğurur.
4. **Otomatik güvenlik yedeğinin de aynı riski taşıdığını unutmayın** — o dosya
   da şifresizdir.

---

# 8 · 🟠 Yüksek: Kilit Ekranı Açıkken Uygulama Arayüzü Bellekte Oluşuyor

**Durum: 🔶 Hâlâ açık — kısmi hafifletme uygulandı (1 Ekim 2026)**

### Bu ne demek

Kilit ekranı gösterilirken uygulamanın geri kalanı arka planda **render edilmeye
devam eder.** Uygulanan iki önlem gerçek ve faydalıdır:

- **Erişilebilirlik izolasyonu** — ekran okuyucular arka planı duymaz.
- **`inert`** — fare ve klavye girdisi arka plana ulaşamaz, odak kilitte kalır.

Ancak ikisi de **görsel** korumadır. Arayüz ağacı bellekte durur; bir ekran
görüntüsü alındığında veya cihazdaki bir hata ayıklama aracıyla bakıldığında
maaş verisi okunabilir. `inert` ayrıca uygulamanın arka planda veritabanını okumaya
devam etmesini de engellemez.

### Kullanıcıya ne yapması gerekiyor

1. **Kilit ekranını göstükten sonra ekranı kapatmayı bir güvenlik önlemi saymayın.**
   Ekran görüntüsü veya kamera açısından koruma sağlamaz.
2. Veri gerçekten hassassa, uygulamayı kilitliyken **arka plana atmayın** —
   uygulama arka planda veriyi bellekte tutmaya devam eder.
3. Bu madde teknik bir borçtur; geliştirme tarafında
   `src/App.tsx` düzeyinde erken çıkışla kapatılması planlanıyor.

---

# 9 · 🟡 Orta: Android'de Veri Cihaz Yedeğine Giriyordu — ✅ ÇÖZÜLDÜ

**Durum: ✅ Çözüldü — 2 Ekim 2026**

### Ne idi

Bu projedeki tüm veri tek bir SQLite dosyasındadır. Android'de uygulama
manifestinde yedekleme kapatılmamıştı ve Android'un varsayılan davranışı
**yedeklemeyi açıktır**. Bu durumda maaş ve ödeme verisi:

- cihaz değiştirildiğinde yeni cihaza **otomatik taşınır**,
- bulutta şifreli olsa da cihazın Google hesabına bağlı her yere gider.

Kullanıcı bunu beklemez ve istemez: sahada çalışan bir ekibin maaş dökümü,
cihazın sahibi olan birinin Google hesabı üzerinden başka bir yere sızabilir.

### Nasıl çözüldü

`<application>` öğesine üç nitelik eklendi — iki Android yolu **ayrı ayrı**
kapatıldı:

- `android:allowBackup="false"` — ana anahtar, tüm sürümler
- `android:fullBackupContent="false"` — Android 11 ve altı
- `android:dataExtractionRules="@xml/data_extraction_rules"` — Android 12+ (API 31)

Ek olarak bir kural dosyası, **dokuz veri alanının** (uygulama verisi, dosyalar,
veritabanları, tercihler, harici depolama ve cihaz aktarımı karşılıkları) hem
bulut yedeğinden hem cihazdan-cihaza aktarımdan dışlanmasını sağlar.

Nitelikler yalnızca uygulamanın kendi manifestinde tanımlıdır; eklenti
manifestlerinden gelen bir ayar birleştirme sırasında bunu ezebileceği için bu
durum da teste bağlandı.

### Kalıcılık — bu kısım önemli

Android projesi Tauri tarafından **üretilen** bir klasördür. Yeni bir
`tauri android init` çalışmasında üretilen dosyaların **üzerine yazılmaz**;
ancak klasör tamamen silinip yeniden üretilirse bu ayarlar kaybolur. Kalıcılık
iki katmanlıdır:

1. Android projesi **git'e izleniyor** — düzenleme sürüm kontrolünde duruyor.
2. `src/__tests__/androidBackup.test.ts` bu ayarları okuyup doğrulayan bir
   regresyon testi içeriyor; dosya silinirse veya geri alınırsa test **kırmızı**
   olur.

**Kalan tek risk**, klasörün silinip yeniden üretilmesidir. Bu durumda
`npx vitest run src/__tests__/androidBackup.test.ts` çalıştırılarak durum
doğrulanabilir.

### Kullanıcıya ne yapması gerekiyor

1. Android'de veriniz artık Google yedeğine **otomatik taşınmaz**. Cihaz
   değiştiriyorsanız veriyi **elle** yedekleyin (bkz. Bulgu 7 — ama şifreli
   saklayın).
2. Yeni bir cihaza geçerken "yedek geri yükleme"nin çalışmadığını göreceksiniz;
   bu kasıtlıdır. Elle yedek almadan geçmeyin.

---

# 10 · 🟠 Yüksek: iOS'ta Veri Cihaz Yedeğine Dahil

**Durum: ⛔ Kabul edilen sınır — 2 Ekim 2026**

### Bu ne demek

Bulgu 9'un iOS karşılığıdır: Android'de kapatılan risk, iOS'ta **açık** duruyor.

Uygulamanın veritabanı dosyası, iOS'ta uygulamanın standart veri dizinine
yazılır. Bu dizin iOS'ta varsayılan olarak **cihaz yedeğine dahil** edilir. Bu
nedenle maaş, ücret geçmişi, ödeme ve denetim verisi:

- iCloud'a yüklenir ve cihazın Apple hesabına bağlı her yere gider,
- cihaz değiştirildiğinde yeni cihaza **otomatik taşınır**.

Bulutta Apple'ın şifrelemesi altındadır; ama ekibin maaş dökümü, cihazın sahibi
olan birinin Apple hesabı üzerinden başka bir yere sızabilir. Bu, Bulgu 9'da
Android için kapatılan riskin birebir aynısıdır.

### Kısmi rahatlama

`Info.plist` doğrulandı: dosya paylaşımı anahtarları **yok**. Yani veri cihazın
**Files uygulamasından** görüntülenip kopyalanamaz. Bu, Bulgu 9'daki ikinci sızma
yolunun iOS karşılığını kapatır.

Ancak bu **yedekleme riskini kapatmaz.** Yedekleme, Files erişiminden tamamen
bağımsız bir kanaldır. Bu ayrım yanlış okunmasın diye açıkça yazıldı: dar bir
rahatlama, çözüm değil.

### Neden bu dalda çözülemedi

Bu tür dışlama, işletim sistemine ait **native** bir API ile yapılır ve yalnızca
uygulamanın native katmanından çağrılabilir. Mevcut çatının Rust ve JavaScript
yüzeylerinde bu API'nin **hiçbir karşılığı yoktur** — bu, ayrı ayrı tarayarak
doğrulandı. Bu, "yapılabilecek bir şey yok" demek değildir: native bir çağrı
yazılabilir, ancak:

1. iOS'a özel bağımlılıklar (Objective-C/Swift köprüsü) eklenmelidir,
2. iOS derlemesi henüz tamamlanmamıştır,
3. Bu davranış **yalnızca gerçek bir iOS cihazda** doğrulanabilir — simülatör
   yeterli değildir.

Bu yüzden bulgu "çözülemez" değil, **"bu dalın kapsamı dışında; native yazım ve
cihazda doğrulama gerektiren bir iş"** olarak kaydediliyor.

### Kullanıcıya ne yapması gerekiyor

1. **iOS'ta bu uygulamayı ekip maaş verisi için kullanıyorsanız, cihazı şifreli
   tutun** — iOS'ta cihaz şifrelemesi varsayılan olarak açıktır ve dosya şifreli
   cihazda saklanır.
2. **iCloud yedeğini bilinçli seçin.** Cihaz ayarlarından bu uygulamaya ait
   yedeklemeyi kapatmak mümkündür; bunu yapacaksanız **önce yedek aldığınızdan
   emin olun** (Bulgu 7 — şifreli saklayın).
3. **Cihaz değiştirmeden önce** veriyi elle dışa aktarın; otomatik taşımaya
   güvenmeyin.
4. Ekibinizin Apple hesabına bağlı cihazlarda veri olduğunu bilin; hesap
   değişikliği ekip üyeleri için bir onay konusudur.

---

## 🛡️ Genel değerlendirme

| Kategori                       | Durum                                                                      |
| ------------------------------ | -------------------------------------------------------------------------- |
| **SQL Injection**              | ✅ Güvenli — Tüm sorgular tek bir kaçış noktasından geçer                  |
| **XSS**                        | ✅ Güvenli — React otomatik escape yapar                                   |
| **Path Traversal**             | ✅ Güvenli — Dosya erişimi uygulamanın indirme dizinine sınırlı            |
| **CSRF**                       | ✅ Uygulanamaz — Yerel uygulama, uzak sunucuya istek yapmaz                |
| **İçerik güvenlik politikası** | ✅ Tanımlı — `default-src 'self'`; hata izleme uçları beyaz listede        |
| **Authentication**             | ⚠️ Kısmi — Düz metin gitti (özet + tuz), ama tuz cihazda açık (Bulgu 1)    |
| **Rate Limiting**              | ⚠️ Kısmi — 5 deneme / 60 sn; sayaç istemci tarafında (Bulgu 2)             |
| **Session Management**         | ❌ Açık — Kurtarma PIN'i kilidi kalıcı kaldırıyor (Bulgu 3)                |
| **Data at Rest**               | ❌ Açık — Veritabanı, yedekler ve denetim günlüğü şifresiz (Bulgu 4, 6, 7) |
| **Telemetry PII**              | ✅ Güvenli — Kayıt tamamen maskeli, varsayılan olarak kapalı (Bulgu 5)     |
| **Platform yedeği (Android)**  | ✅ Güvenli — İki yol da kapatıldı, regresyon testiyle korundu (Bulgu 9)    |
| **Platform yedeği (iOS)**      | ❌ Açık — Dışlama yüzeyi yok (Bulgu 10)                                    |
| **Render yüzeyi**              | ⚠️ Kısmi — Girdi izolasyonu var, arayüz bellekte oluşuyor (Bulgu 8)        |

---

## 🧭 Kullanıcı için tek sayfalık kontrol listesi

**Kurulumdan önce**

- [ ] Cihazınızın tam disk şifrelemesi açık mı?
- [ ] Cihaz parolanız güçlü ve otomatik kilit süreniz kısa mı?
- [ ] Yedek dosyalarınızı nereye, nasıl saklayacağınıza karar verdiniz mi?
- [ ] Ekibinize, bu cihazda maaş verisi tutulduğunu açıkladınız mı?

**Kurulumda**

- [ ] Uygulama kilidini açtınız mı ve PIN/deseni tahmin edilemez mi?
- [ ] Kurtarma PIN'ini ayrı seçip **not ettiniz** mi? (Bulgu 3)
- [ ] Hata izlemeyi bilerek açtınız mı, yoksa kapalı mı kaldı? (Bulgu 5)

**Sürekli**

- [ ] Yedekleri şifreli saklıyor musunuz? (Bulgu 7)
- [ ] Cihazı açık bırakmıyorsunuz?
- [ ] iOS kullanıyorsanız yedekleme kararını bilinçli aldınız mı? (Bulgu 10)

---

## 🏆 Özet

**En kritik gerçek sınır (Bulgu 6):** Veritabanı diske şifresiz yazılır.
Uygulamanın kendi kodu bunu kapatamaz, çünkü korumak için gerekli anahtar
uygulamanın belleğinde durmalıdır. Bu, bir eksik değil; Tauri tabanlı yerel bir
masaüstü uygulamasının doğasıdır. **Çözüm cihazdadır: tam disk şifreleme.**

**Kazanılanlar:** Düz metin kimlik bilgileri gitti (özet + tuz), kaba kuvvete
karşı deneme sınırı geldi, hata izlemeyle maaş verisi sızıntısı kapatıldı,
Android'de cihaz yedeğine kazara sızma engellendi. Bunların dördü de geri alınabilir
düzeltmelerdir ve sürüm kontrolündedir.

**Kabul edilen sınır:** Uygulama kilidi istemci tarafındadır. Bu, onu
**gizlilik önlemi** yapar; **güvenlik sınırı** yapmaz. Ürünün kullanıcıya vaadi de
budur: masada açık duran telefonunuzu gözetir, cihazınıza teknik olarak
erişen birini değil.

### Bu belgeyi yayımlamak mı, silmek mi?

Bu belge public depoda kalabilir ya da silinebilir. Karar size kalmış; iki
seçeneğin bedeli açıkça şöyle:

| Seçenek                     | Artıları                                                                                                                                                                                                                                                                                             | Eksileri                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Yayımla** (önerim)        | Kullanıcı gerçeği öğrenir ve kendi cihazını doğru yapılandırır. Şeffaflık, güven uçurumunu önler — bir "şifreli veritabanı" beklentisi doğurmayan bu uygulama, şeffaflıkla **kullanıcı güveni kazanır**. Güvenlik açığı bildirimleri zaten bu belgeden gelir; belgede olmayan bir açık, bildirilmez. | Saldırı yüzeyini bilinçli olarak tanımlar. Düzeltilmemiş madde 3, 7 ve 10, bilerek uygulama kullanan birinin istismar edebileceği boşluklardır.                                                                                    |
| **Sil / içsel belgede tut** | Uygulamayı gerçekten kullanan kişiler (saha şefleri, muhasebe) teknik ayrıntıyla uğraşmaz. Kapalı bir bulgu listesini korursunuz.                                                                                                                                                                    | Kullanıcı, uygulamayı neden koruyamadığını **bilmez**; bulgu 6'nın gerektirdiği disk şifreleme adımını atlar. "Gizli belgede yazan şey gizli güvenliktir" yanılgısı sürer. Kısa vadede küçük, uzun vadede gerçek bir itibar riski. |

**Önerim: yayımlayın, ama tam olarak bu sürümüyle.** Bu sürüm zayıf noktaları
kabul eder ve her biri için kullanıcıya somut bir adım verir; hiçbir saldırı
prosedürü içermez. Sadece Bulgu 1, 3 ve 10'daki **teknik ayrıntı satırlarını**
(ayrıntılı mekanizma açıklamaları) çıkarmak isterseniz, o üç paragrafı
kısaltmak yeterlidir — belgenin kullanıcıya verdiği yönlendirme bozulmaz.

**Kararınız ne olursa olsun, kullanıcıya ne yapması gerektiğini bir yerde
söyleyin.** Bu raporun var olma sebebi, o listenin gitmesidir.
