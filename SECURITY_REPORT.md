# 🔒 İş Takip — Güvenlik Denetim Raporu

**Tarih:** 3 Temmuz 2026
**Denetleyen:** Hermes Agent (DeepSeek V4 Flash)
**Hedef Uygulama:** is-takip v0.1.0 (Tauri + React + SQLite)

---

## 📋 Özet

| Seviye        | Açıklama                                            | Etki                              |
| ------------- | --------------------------------------------------- | --------------------------------- |
| 🔴 **KRİTİK** | App Lock Kimlik Bilgileri localStorage'da Düz Metin | Fiziksel erişimle tam veri ihlali |
| 🟠 **YÜKSEK** | Hız Sınırlaması Yok — Brute-force Açığı             | PIN/pattern kırılabilir           |
| 🟡 **ORTA**   | Kurtarma PIN'i Kilidi Kalıcı Olarak Kaldırır        | Lock tamamen devre dışı kalır     |
| 🟢 **DÜŞÜK**  | Audit Log'da Hassas Veri (Plaintext)                | Veri gizliliği ihlali             |

---

## 🔴 KRİTİK: App Lock Kimlik Bilgileri localStorage'da Düz Metin

### Konum

`src/components/AppLockOverlay.tsx`, satır 28-30:

```typescript
// Load configured sequence and PIN
const configuredSequence: string[] = JSON.parse(localStorage.getItem("appLockSequence") || "[]");
const configuredPin = localStorage.getItem("appLockPin") || "";
```

### Açıklama

Uygulama kilidi için kullanılan **emoji deseni (3'lü sıra)** ve **4 haneli PIN kodu**, tarayıcının `localStorage` API'sinde **hiçbir kriptografik koruma olmadan düz metin (plaintext)** olarak saklanır.

### Etkilenen Dosyalar

| Dosya                                | Rol                                                                     |
| ------------------------------------ | ----------------------------------------------------------------------- |
| `src/components/AppLockOverlay.tsx`  | localStorage'dan okuyarak doğrulama yapar                               |
| `src/components/LockSetupWizard.tsx` | localStorage'a yazar                                                    |
| `src/App.tsx` (satır 118-131)        | `localStorage.getItem("appLockEnabled")` ile lock durumunu kontrol eder |

### Kanıt — localStorage İçeriği (Örnek)

```
Key                  Value
──────────────────────────────────────────────
appLockEnabled       "true"
appLockSequence      '["panda","rocket","diamond"]'
appLockPin           "1234"
```

### Saldırı Senaryosu — Fiziksel Erişim ile Atak

**Ön koşul:** Saldırgan, hedefin macOS cihazına fiziksel erişime sahip (ör: iş arkadaşı, aile üyesi).

**Adım 1:** Tauri v2, WKWebView localStorage'ını şu konumda saklar:

```
~/Library/Containers/com.mby.istakip/Data/Library/WebKit/WebsiteData/
   LocalStorage/https_localhost_1420.localstorage
```

Bu bir **SQLite veritabanı dosyasıdır** ve herhangi bir SQLite okuyucu ile açılabilir.

**Adım 2:** Dosyayı okumak için terminalde:

```bash
sqlite3 ~/Library/Containers/com.mby.istakip/Data/Library/WebKit/\
WebsiteData/LocalStorage/https_localhost_1420.localstorage \
"SELECT key, value FROM ItemTable WHERE key LIKE 'appLock%';"
```

**Çıktı:**

```
appLockEnabled|true
appLockSequence|["panda","rocket","diamond"]
appLockPin|1234
```

**Adım 3:** Saldırgan artık:

- Emoji desenini biliyor → uygulamayı zahmetsizce açar
- PIN'i biliyor → "Şifremi Unuttum" ile girer, kilidi tamamen devre dışı bırakır
- localStorage'a `appLockEnabled=false` yazarak da kilidi bypass edebilir:
  ```bash
  sqlite3 <dosya> "DELETE FROM ItemTable WHERE key='appLockEnabled';"
  ```

**Adım 4:** Uygulama açıldığında saldırgan:

- Tüm çalışan bilgilerini (isim, yevmiye, tip) görebilir
- Tüm ödeme kayıtlarını görebilir
- PDF raporları indirebilir
- Yedekleme dosyasını kopyalayabilir
- Yanlış veri girişi yaparak sistemi sabote edebilir
- Audit log'ları okuyabilir

### Etki Değerlendirmesi

| Metrik              | Değer                           |
| ------------------- | ------------------------------- |
| CVSS v3.1 Skoru     | **8.6 / 10** (HIGH)             |
| Attack Vector       | **Physical** (fiziksel erişim)  |
| Attack Complexity   | **Low** (SQLite okuma)          |
| Privileges Required | **None**                        |
| User Interaction    | **None**                        |
| Confidentiality     | **HIGH** — tüm finansal veriler |
| Integrity           | **HIGH** — veri manipülasyonu   |
| Availability        | **LOW** — veri silme mümkün     |

### Önerilen Çözüm

1. **PIN'i hash'le:** SHA-256 veya bcrypt ile PIN'i hash'leyerek sakla:

   ```typescript
   // LockSetupWizard.tsx — kaydederken
   const pinHash = await crypto.subtle.digest("SHA-256",
     new TextEncoder().encode(pin));
   localStorage.setItem("appLockPinHash",
     Array.from(new Uint8Array(pinHash)).map(b => b.toString(16)).join(""));

   // AppLockOverlay.tsx — doğrularken
   const inputHash = await crypto.subtle.digest("SHA-256", ...);
   // inputHash === storedHash
   ```

2. **Emoji desenini hash'le:** Aynı şekilde emoji ID'lerini hash'le.

3. **Device-specific encryption:** `@tauri-apps/plugin-store` ile encrypted storage kullan:

   ```bash
   # Tauri plugin ile şifreli depolama
   npm install @tauri-apps/plugin-store
   ```

   Bu, veriyi iCloud Keychain/ macOS Keychain'e kaydeder.

4. **Rate limiting ekle:** 5 başarısız denemeden sonra 30 saniye bekleme.

---

## 🟠 YÜKSEK: Hız Sınırlaması Yok — Brute-force Açığı

### Konum

`src/components/AppLockOverlay.tsx`, satır 64-94 (PIN girişi) ve 33-61 (emoji pattern girişi)

### Açıklama

Hem emoji deseni hem de PIN girişinde **herhangi bir hız sınırlaması, lockout mekanizması veya gecikme yoktur**. Saldırgan saniyede onlarca deneme yapabilir.

### PIN Brute-force Hesabı

- 4 haneli PIN: 10.000 olasılık
- Saniyede 10 deneme → ~16 dakikada tüm PIN'ler denenebilir
- **Hiçbir gecikme veya bloklama yok**

### Emoji Pattern Brute-force

- 9 emoji arasından 3'lü sıra (permütasyon): 9 × 8 × 7 = 504 olasılık
- Saniyede 10 deneme → ~50 saniyede tüm pattern'ler denenebilir

### Kanıt — Kodda Rate Limiting Yok

```typescript
const handlePinKeyPress = (num: string) => {
  // ... her tuşa basışta hiçbir sayaç kontrolü YOK
  if (recoveryPin.length >= 4) return;
  const newPin = recoveryPin + num;
  // ... hemen doğrulama
  if (newPin === configuredPin) { ... }
};
```

### Önerilen Çözüm

```typescript
const [attempts, setAttempts] = useState(0);
const [lockUntil, setLockUntil] = useState<number | null>(null);

const handlePinKeyPress = (num: string) => {
  if (lockUntil && Date.now() < lockUntil) {
    addToast(`${Math.ceil((lockUntil - Date.now()) / 1000)}sn bekleyin`, "error");
    return;
  }
  // ... PIN check
  if (wrong) {
    const newAttempts = attempts + 1;
    setAttempts(newAttempts);
    if (newAttempts >= 5) {
      setLockUntil(Date.now() + 30000); // 30sn lock
      setAttempts(0);
    }
  }
};
```

---

## 🟡 ORTA: Kurtarma PIN'i Kilidi Kalıcı Olarak Kaldırır

### Konum

`src/components/AppLockOverlay.tsx`, satır 71-83

### Açıklama

Kurtarma PIN'i doğru girildiğinde, kod **tüm kilit ayarlarını localStorage'dan siler**:

```typescript
if (newPin === configuredPin) {
  localStorage.removeItem("appLockEnabled");
  localStorage.removeItem("appLockSequence");
  localStorage.removeItem("appLockPin");
  // ...
  window.location.reload(); // Kilit kalıcı olarak gitti!
}
```

### Sorun

- Kullanıcı PIN'i unutunca "Şifremi Unuttum" kullanır → kilit tamamen silinir
- Tekrar kilit kurmak için LockSetupWizard'a gitmesi gerekir
- Kullanıcı PIN'i unuttuysa, kurulum sihirbazını da unutmuş olabilir
- **Bir kere kilit kalktı mı, bir daha otomatik kilit gelmez**

### Önerilen Çözüm

PIN doğru girildiğinde kilidi **silme**, sadece **geçici olarak atla**:

```typescript
// Lock kalkmasın, sadece bu oturum için geçişe izin ver
sessionStorage.setItem("tempUnlock", "true");
onUnlock();
```

Veya daha iyisi, bir "kurtarma e-postası" benzeri bir akış. Ama bu local bir uygulama olduğu için en pratik çözüm:

```typescript
// PIN yanlışsa → kilit kalır, sadece yeni pattern kurulumuna izin ver
// (pattern'i sıfırlamak için eski PIN'i bilmesi yeterli)
if (newPin === configuredPin) {
  // Kilidi KALDIRMA, sadece şu an için aç
  sessionStorage.setItem("sessionUnlocked", Date.now().toString());
  onUnlock();
}
// App.tsx'de: isUnlocked = localStorage.getItem("appLockEnabled") !== "true"
//              || sessionStorage.getItem("sessionUnlocked")
// Bir sonraki visibilityChange'de sessionStorage temizlenir
```

---

## 🟢 DÜŞÜK: Audit Log'da Hassas Verı (Plaintext)

### Konum

SQLite trigger'ları (`src/schema/triggers.ts` ve Rust migration'ları)

### Açıklama

Tüm audit log kayıtları, pipe-delimited formatında hassas verileri **düz metin** olarak içerir.

```sql
-- Audit log örneği:
'worker_id=5|amount=50000|date=2026-06-15|description=Maaş'
'name=Ahmet|type=ORTAK|wage=0'
'date=2026-06-15|production=120|earned=45000|expenses=5000'
```

### Etki

- `audit_logs` tablosu yedekleme dosyasına dahil edilir
- Bir `.json` yedek dosyası ele geçirilirse tüm finansal tarihçe okunabilir
- Çalışan maaşları, ödeme miktarları, günlük kazançlar... hepsi açık

### Önerilen Çözüm

Trigger'larda hassas verileri loglamaya devam et (geri alma için gerekli), ama yedekleme sırasında audit_logs'u opsiyonel yap veya export öncesi kullanıcıya bildir.

---

## 🛡️ Genel Değerlendirme

| Kategori                       | Durum                                                           |
| ------------------------------ | --------------------------------------------------------------- |
| **SQL Injection**              | ✅ Güvenli — Tüm sorgular parameterized                         |
| **XSS (Cross-Site Scripting)** | ✅ Güvenli — React JSX otomatik escape yapar                    |
| **Path Traversal**             | ✅ Güvenli — Tauri plugin-fs BaseDirectory.Download ile sınırlı |
| **CSRF**                       | ✅ N/A — Local uygulama, network isteği yok                     |
| **Authentication**             | ❌ **KRİTİK** — localStorage plaintext                          |
| **Rate Limiting**              | ❌ **YÜKSEK** — Hiçbir sınırlama yok                            |
| **Session Management**         | ❌ **ORTA** — Kurtarma PIN'i kalıcı hasar                       |
| **Data at Rest**               | ❌ **DÜŞÜK** — Audit log'ları şifresiz                          |

---

## 🏆 Özet

**En kritik güvenlik açığı:** Uygulama kilidi (App Lock) sisteminin `localStorage`'a güvenmesi. Bu:

1. **localStorage** macOS'ta düz bir SQLite dosyası olarak saklanır
2. Fiziksel erişimi olan herkes bu dosyayı okuyup PIN/pattern'i çıkarabilir
3. PIN veya pattern ele geçince tüm finansal verilere erişim sağlanır
4. Kurtarma PIN'i girilince kilit kalıcı olarak yok olur

**Önerilen aksiyonlar (öncelik sırasına göre):**

1. 🚨 **HEMEN:** PIN ve emoji pattern'ini hash'leyerek sakla
2. 🚨 **HEMEN:** Rate limiting ekle (5 deneme → 30sn lockout)
3. ⚠️ **KISA VADE:** Kurtarma PIN'i kilidi silmesin, session bazında atlama yapsın
4. 📋 **ORTA VADE:** `@tauri-apps/plugin-store` ile encrypted storage'a geç
5. 📋 **ORTA VADE:** Backup export'ta audit_logs'u opsiyonel yap
