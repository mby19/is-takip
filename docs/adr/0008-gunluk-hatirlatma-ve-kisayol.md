# ADR-0008: Günlük Hatırlatma, Bildirim Eylemleri ve Uygulama Kısayolu

**Tarih:** 2026-09-12
**Statü:** Kabul Edildi

## Bağlam

Uygulamanın değeri her gün puantaj girilmesine bağlı. Atlanan bir gün ay sonu
hesabını eksik bırakıyor ve geriye dönük hatırlamak zor. Kullanıcının isteği:
günlük hatırlatma, bildirim üzerinden hızlı yoklama ve uygulama simgesinden
kısayol.

## Karar

### 1. Bildirimler tek tek günler için kurulur

`Schedule.every(Day)` ile tek bir tekrarlayan bildirim en basit yol olurdu ama
işe yaramıyor: bildirimi işletim sistemi zamanlıyor, uygulama kapalıyken
"bugün veri girilmiş mi" diye veritabanına bakamıyor. Veri girilmiş günlerde de
çalan bir hatırlatma birkaç günde kapatılır.

Bunun yerine önümüzdeki **14 gün ayrı ayrı** kurulur (`Schedule.at`). Uygulama
her açıldığında, ayar değiştiğinde ve puantaj yazıldığında hepsi iptal edilip
yeniden kurulur; bugünün verisi girilmişse bugün atlanır. 14 gün, uygulamanın
iki hafta hiç açılmaması durumunda bile hatırlatmanın sürmesi için yeterli.

Yeniden kurulum ucuz olmadığından (`14 IPC çağrısı`) `syncReminders` bir imza
tutar (`açık|saat|tarih|bugün-dolu-mu`); imza değişmediyse hiçbir şey yapmaz.

Hangi günlerin kurulacağını hesaplayan kısım (`planReminders`) eklentiden
bağımsız saf bir fonksiyondur ve testleri vardır.

### 2. Eklentinin iki tuzağı

İkisi de sessiz başarısızlığa yol açtığı için burada kayıtlı:

- **`cancelAll()` Android'de çalışmıyor.** Kotlin tarafındaki `CancelArgs`
  sınıfında `notifications` alanı `lateinit` (zorunlu), `cancelAll()` ise bu
  alanı hiç göndermiyor; çağrı hata veriyor. Hata yutulduğu için tek bir
  bildirim bile kurulmadan sessizce çıkılıyordu. Çözüm: kendi kimlik
  aralığımızı (`9100..9113`) `cancel(ids)` ile açıkça iptal etmek. Yan faydası,
  başka bildirimlere dokunmaması.

- **`isPermissionGranted()` güvenilmez.** Önce `window.Notification.permission`
  değerine bakıp kısa devre yapıyor; Android webview'inde bu değer izin
  verildikten sonra da güncel olmayabiliyor. Eklentiye doğrudan
  `plugin:notification|is_permission_granted` komutu ile sorulur; `null`
  ("henüz belirlenmedi") durumunda kurulum yine de denenir.

### 3. Kapalı uygulamada bildirim eylemi kaybolur — telafisi arayüzde

Android eklentisi, uygulama tamamen kapalıyken gelen eylemi `load()` içinde
tetikliyor; web tarafı dinleyici henüz kurulmadığı için olay kayboluyor.
Uygulama açıksa (`onNewIntent`) eylem sorunsuz geliyor.

Bunu eklentiye dokunmadan çözmek mümkün değil. Telafisi takvimdeki
`ReminderBanner`: hatırlatma saati geçmiş ve bugün boşsa aynı iki seçenek
("Herkes tam gün" / "Tek tek gir") ekranda duruyor. Böylece hangi yoldan
gelinirse gelinsin kullanıcı tek dokunuşla günü kapatabiliyor.

### 4. Kısayol derin bağlantı ile çalışır

`res/xml/shortcuts.xml` içindeki kısayol `istakip://bugun` adresini açar;
`tauri-plugin-deep-link` bunu hem uygulama açıkken (`onOpenUrl`) hem de
kapalıyken (`getCurrent()`) verir — kısayol her iki durumda da doğrudan bugünün
puantaj kartını açar. Bildirim eylemlerinin aksine burada kayıp yok, çünkü
eklenti açılış bağlantısını saklıyor.

### 5. Toplu doldurma mevcut kayıtları ezmez

`markTodayFull` yalnızca bugün için **kaydı olmayan** aktif çalışanları tam güne
çeker. Kullanıcı birine bilerek "yok" demişse toplu doldurma bunu bozmamalı.
Kapalı dönemde çalışmaz (`ClosedPeriodError`).

## Sonuçlar

- Hatırlatma ayarı cihaza özeldir (`localStorage`), yedeğe girmez.
- Bildirim izni uygulama açılışında değil, kullanıcı hatırlatmayı açtığında
  istenir — o an ne için sorulduğu bellidir.
- Yeni bağımlılıklar: `tauri-plugin-notification`, `tauri-plugin-deep-link`.
  Sürümleri `tauriVersions.test.ts` tarafından npm/Rust arasında kontrol edilir.
- `istakip://` şeması artık uygulamaya kayıtlı.

---

## Güncelleme (2026-10-01) — Kurulum imzası ve masaüstü tuzakları

ADR'lar değiştirilmez; yalnızca not düşülür. Aşağıdaki ayrıntılar madde 1 ve
madde 2'nin uygulamasında ortaya çıkan ve kararın çekirdeğini değiştirmeyen
düzeltmelerdir. Kararın kendisi — 14 günlük hatırlatma, bildirim eylemleri,
`istakip://bugun` kısayolu, toplu doldurmanın mevcut kayıtları ez-memesi —
geçerlidir.

### Madde 1 — Kurulum imzası iki kez genişletildi

İmza artık `açık|saat|tarih|bugün-dolu-mu|saat-dilimi` biçimindedir. İki ek
bileşenin nedeni:

- **«Bugün dolu» ölçütü (`isDayComplete`):** aktif çalışanların _hepsi_ için
  bugün kayıt olmalı. «Tek bir kayıt yeter» ölçütü 40 kişilik sahada 1 kişi
  işaretlenince günü dolu sayıyor, geri kalan 39 kişinin bildirimini hiç
  kurmuyordu. Ölçütün tek kaynağı `syncReminders` içindeki SQL sorgusudur;
  `ReminderBanner` aynı kuralı kullanır.
- **Saat dilimi:** Alarmlar mutlak an olarak (`Schedule.at`) kurulduğu için
  yurtdışına çıkıldığında ya da cihaz saati elle değiştirildiğinde hepsi eski
  yerel saatte çalışıyordu. İmzadaki `timeZone@offset` değişince bir sonraki
  senkronizasyon 14 alarmı yeniden planlar.

**İmza ne zaman yazılır:** imza **yalnızca kurulum tamamen bittikten sonra**
yazılır; izin reddi ya da herhangi bir hata imzayı sıfırlar, böylece bir
sonraki çağrıda kurulum yeniden denenir. (Önceden yazılırsa kullanıcı sonradan
bildirim iznini açsa bile hatırlatma hiç kurulmuyordu.)

### Madde 2 — Eklentinin üçüncü tuzağı: `cancel` masaüstünde hiç yok

Masaüstü derlemesinin `invoke_handler` listesinde yalnızca `notify`,
`request_permission` ve `is_permission_granted` var; `cancel`, `get_pending` ve
`register_action_types` kayıtlı değil. `syncReminders` bu yüzden
`isMobilePlatform()` ile platformu denetler ve **masaüstünde hiçbir zamanlama
denemesi yapmaz** — `Schedule.at` de masaüstünde yok sayıldığı için 14
bildirimin hepsi o anda ekrana fırlıyordu, üstelik her senkronizasyonda
"command not found" hatası Sentry'ye düşüyordu.

### Madde 2 — `isPermissionGranted()` kesin `false` dönerse kurulum yapılmaz

Eklentinin `isPermissionGranted()` fonksiyonu güvenilmezdir (ayrıntı gövdede).
Değişen davranış: `plugin:notification|is_permission_granted` komutundan kesin
`false` dönse kurulum yapılmaz, imza yazılmaz ve kullanıcıya toast gösterilir.
`null` ("henüz belirlenmedi") durumunda kurulum yine de denenir.

### Madde 5 — `setTime` geçersiz girdiyi reddeder

Eski saat korunur ve çağıran kullanıcıya bildirilir. Sessizce varsayılana
yazmak, kullanıcının seçtiği saati onaylamasına rağmen başka bir saat
kurulmasına yol açıyordu.

`setTime` artık geçersiz girdi karşısında `ClosedPeriodError`'a benzer bir hata
yayar ve çağıran kullanıcıya bildirir.

### Ek — `syncReminders` bir sonuç döndürür

Dönüş değeri `kuruldu` / `izin-yok` / `hata` / `masaustu-desteklenmiyor`
durumlarından biridir; `useReminders` hook'u bu sonucu kullanıcıya toast olarak
gösterir.
