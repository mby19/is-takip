import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

/**
 * Android release imzası.
 *
 * Tauri v2'de Android release imzasını `tauri.conf.json` üzerinden
 * yapılandıran bir alan YOK — resmi yol bu dosyadır
 * (https://v2.tauri.app/distribute/sign/android). `gen/` altında olduğu için
 * Tauri tarafından yeniden üretilebilir; `src/__tests__/androidSigning.test.ts`
 * bu blok silinirse/geri alınırsa hata verir.
 *
 * Değer kaynak sırası: ortam değişkenleri → `keystore.properties`.
 *   ANDROID_KEY_BASE64_PATH – keystore dosyasının yolu (CI `release.yml`'de doldurur)
 *   ANDROID_KEY_ALIAS       – keystore içindeki anahtar takma adı
 *   ANDROID_KEY_PASSWORD    – anahtar parolası
 *   keystore.properties     – yerel geliştirici için alternatif
 *                             (storeFile / keyAlias / keyPassword / storePassword)
 */
val keystoreProperties = Properties().apply {
    val propsFile = rootProject.file("keystore.properties")
    if (propsFile.exists()) propsFile.inputStream().use { load(it) }
}

fun signingSetting(env: String, key: String): String? =
    providers.environmentVariable(env).orNull?.takeIf { it.isNotBlank() }
        ?: keystoreProperties.getProperty(key)?.takeIf { it.isNotBlank() }

val releaseStorePath = signingSetting("ANDROID_KEY_BASE64_PATH", "storeFile")
val releaseKeyAlias = signingSetting("ANDROID_KEY_ALIAS", "keyAlias")
val releaseKeyPassword = signingSetting("ANDROID_KEY_PASSWORD", "keyPassword")
val releaseSigningAvailable =
    releaseStorePath != null && releaseKeyAlias != null && releaseKeyPassword != null

/**
 * Sır yoksa release imzası üretilemez ve bunu GİZLİCE debug imzasına
 * düşürerek yapmayız: Play Console reddi, cihazda "geliştirilmemiş uygulama"
 * uyarısı ve kullanıcının fark etmeyeceği bir sürüm kaybı.
 *
 * Kontrol görev grafiği ÇÖZÜMLENDİĞİNDE yapılır (`whenReady`), görev
 * başında değil: böylece Rust/Gradle derlemesi onlarca dakika çalışıp
 * sonunda imza hatası vermek yerine saniyeler içinde durur. `assembleDebug`
 * ve `signingReport` grafiğe girmediği için sır istemez.
 *
 * `tauri android build --apk` → `assembleRelease`, `--aab` → `bundleRelease`.
 * AGP ayrıca ABI başına `assembleArm64Release` gibi görevler üretir; desen
 * hepsini kapsıyor. `validateSigning*Release` görevleri imza yapılandırması
 * OLMADAN hiç oluşmadığı için onlara bağlanmak yanlış olurdu.
 */
gradle.taskGraph.whenReady {
    val releasePackagingRequested = allTasks.any { task ->
        (task.name.startsWith("assemble") || task.name.startsWith("bundle")) &&
            task.name.endsWith("Release")
    }
    if (releasePackagingRequested && !releaseSigningAvailable) {
        throw GradleException(
            "Android release imzası üretilemedi: ANDROID_KEY_BASE64_PATH, " +
                "ANDROID_KEY_ALIAS ve ANDROID_KEY_PASSWORD tanımlı değil " +
                "(alternatif: src-tauri/gen/android/keystore.properties). " +
                "Release derlemesi sessizce debug anahtarına düşmez — gerçek " +
                "bir upload keystore olmadan Play'e gönderilemeyecek bir APK/AAB " +
                "üretmek yerine burada duruyor. Üretim bilgisi: " +
                "docs/magaza-yayin-rehberi.md"
        )
    }
}

android {
    signingConfigs {
        if (releaseSigningAvailable) {
            create("release") {
                storeFile = rootProject.file(releaseStorePath!!)
                keyAlias = releaseKeyAlias
                keyPassword = releaseKeyPassword
                storePassword =
                    signingSetting("ANDROID_KEYSTORE_PASSWORD", "storePassword")
                        ?: releaseKeyPassword
            }
        }
    }
    compileSdk = 36
    namespace = "com.mby.istakip"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.mby.istakip"
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
            // Sır yoksa `signingConfigs.getByName("release")` hiç OLUŞTURULMAZ;
            // bu satır koşulsuz çalıştığı için yalnızca sırlar tanımlıysa
            // bağlanıyoruz. Sır yoksa `validateSigningRelease` yukarıdaki
            // GradleException'ı fırlatır — debug imzasına sessiz geri dönüş YOK.
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")