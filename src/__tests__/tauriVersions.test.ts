import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tauri'nin NPM paketi ile Rust crate'i aynı major.minor sürümde olmalı;
 * değilse `tauri build` daha derlemeye başlamadan reddediyor.
 *
 * İkisi bağımsız sürüm aralıklarıyla (`^2`) yüklendiği için sessizce
 * kayabiliyorlar ve hata ancak APK alınırken ortaya çıkıyordu. Bu test,
 * commit öncesi çalıştığı için kaymayı anında yakalar.
 */
const root = resolve(__dirname, "../..");
const minor = (v: string) => v.replace(/^[~^]/, "").split(".").slice(0, 2).join(".");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const cargoToml = readFileSync(resolve(root, "src-tauri/Cargo.toml"), "utf8");

/**
 * Eklenti listesi BURAYA YAZILMAZ. `Cargo.toml`'dan türetilir.
 *
 * Hardcode edilmiş bir liste iki yönlü yanlış veriyordu: kullanıcı bir eklentiyi
 * sildiğinde test kırılıyordu (`tauri-plugin-opener` — olmuştu), eklediğinde ise
 * test o eklentiyi hiç görmeden yeşil kalıyordu. Artık tek doğruluk kaynağı
 * manifestlerin kendisi; yeni eklenti eklendiğinde izlenir, silindiğinde sessizce
 * listeden düşer.
 */
const crates = [...cargoToml.matchAll(/^(tauri-plugin-[a-z0-9-]+)\s*=/gm)].map((m) => m[1]);

describe("Tauri sürüm tutarlılığı", () => {
  // Kaynak olarak BEYAN EDİLEN aralık değil, KİLİTLİ sürüm okunur:
  // "^2" gibi bir aralık hangi sürümün kurulduğunu söylemez.
  const npmLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const lock = readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8");

  const npmDeps: Record<string, string> = {
    ...(pkg.dependencies ?? {}),
    ...(pkg.devDependencies ?? {}),
  };

  const capsDir = resolve(root, "src-tauri/capabilities");
  const izinler = readdirSync(capsDir)
    .filter((f) => f.endsWith(".json"))
    .flatMap((f) => JSON.parse(readFileSync(resolve(capsDir, f), "utf8")).permissions ?? []);

  it("@tauri-apps/api ile tauri crate'i aynı minor sürümde", () => {
    const api = npmLock.packages?.["node_modules/@tauri-apps/api"]?.version;
    const match = lock.match(/name = "tauri"\nversion = "([^"]+)"/);
    expect(api, "@tauri-apps/api package-lock.json içinde yok").toBeDefined();
    expect(match, "tauri crate'i Cargo.lock içinde yok").not.toBeNull();
    expect(minor(api!), `api ${api} vs crate ${match![1]}`).toBe(minor(match![1]));
  });

  it("türetme bozulmadı: Cargo.toml'dan eklenti okundu", () => {
    expect(crates.length, "Cargo.toml'dan hiç eklenti okunamadı").toBeGreaterThan(0);
  });

  it("her Rust eklentisinin npm karşılığı package.json'da tanımlı", () => {
    // `tauri-plugin-sql` -> `@tauri-apps/plugin-sql`: adlandırma kuralı sabit,
    // yani eklenti listesinden bağımsız türetilebiliyor.
    const eksik = crates
      .map((crate) => `@tauri-apps/${crate.replace(/^tauri-plugin-/, "plugin-")}`)
      .filter((npmName) => !(npmName in npmDeps));
    expect(eksik, "Rust tarafında var ama npm tarafında yok").toEqual([]);
  });

  it("eklenti sürümleri npm ve Rust tarafında uyuşuyor", () => {
    for (const crate of crates) {
      const npmName = `@tauri-apps/${crate.replace(/^tauri-plugin-/, "plugin-")}`;
      const version = npmLock.packages?.[`node_modules/${npmName}`]?.version;
      const match = lock.match(new RegExp(`name = "${crate}"\\nversion = "([^"]+)"`));
      if (!version || !match) continue; // eksik bağımlılık yukarıda zaten yakalanıyor
      expect(minor(version), `${npmName} (${version}) ile ${crate} (${match[1]}) uyuşmuyor`).toBe(
        minor(match[1]),
      );
    }
  });

  it("her eklenti capability dosyasında izin almış", () => {
    // Kapsam dışı bırakılan (0 çağıran) eklenti burada yakalanır:
    // capability'siz eklenti çalışma anında sessizce başarısız oluyor.
    const yetkisiz = crates.filter(
      (crate) =>
        !izinler.some((p: string) => p.startsWith(`${crate.slice("tauri-plugin-".length)}:`)),
    );
    expect(yetkisiz, "capabilities/default.json içinde izni yok").toEqual([]);
  });
});

/**
 * UYGULAMA sürümü `package.json`, `tauri.conf.json` ve `Cargo.toml`'da ÜÇ ayrı
 * yerde tutuluyor. Tauri build'i hangisini kullandığında hangisinin
 * kaldığını söylemiyor; sürümü sadece `package.json`'da bump edip
 * `tauri.conf.json`'ı unutmak, yayınlanan paketin adı ile içindeki sürümün
 * birbirinden farklı olması demek (updater bu yüzden yanlış sürümü görür).
 *
 * Otomatik senkron bir build script gerektirirdi; senkronun kendisini tek
 * doğruluk kaynağından türetmek kırılgan. Test kontrolü dayanıklı: üçü
 * eşit değilse `tauri build`'den önce kırmızıya döner.
 */
describe("Uygulama sürümü senkron", () => {
  const tauriConf = JSON.parse(readFileSync(resolve(root, "src-tauri/tauri.conf.json"), "utf8"));
  const cargoVersion = cargoToml.match(/^\[package\][\s\S]*?^version\s*=\s*"([^"]+)"/m)?.[1];

  it("üç manifest'te sürüm okunabildi", () => {
    expect(pkg.version, "package.json version yok").toMatch(/^\d+\.\d+\.\d+/);
    expect(tauriConf.version, "tauri.conf.json version yok").toMatch(/^\d+\.\d+\.\d+/);
    expect(cargoVersion, "Cargo.toml [package] version yok").toMatch(/^\d+\.\d+\.\d+/);
  });

  it("package.json, tauri.conf.json ve Cargo.toml aynı sürümü taşıyor", () => {
    expect(
      {
        "package.json": pkg.version,
        "tauri.conf.json": tauriConf.version,
        "Cargo.toml": cargoVersion,
      },
      "sürümler ayrışmış — üçünü de aynı değere getir",
    ).toEqual({
      "package.json": pkg.version,
      "tauri.conf.json": pkg.version,
      "Cargo.toml": pkg.version,
    });
  });

  it("sürüm 'v' öneki olmadan düz semver (tag eşleşmesi için)", () => {
    for (const v of [pkg.version, tauriConf.version, cargoVersion]) {
      expect(v, "sürümde 'v' öneki var, git tag 'v' ile uyuşmaz").toMatch(/^\d+\.\d+\.\d+$/);
    }
  });
});

/**
 * `npm ci`, `package.json` ile `package-lock.json` uyuşmadığında kurulumun
 * başında hata veriyor — CI'ın her job'ı `npm ci` ile başladığı için bu
 * tutarsızlık public repoya ilk push'ta derlemeyi kırıyordu. `npm ci`
 * ağ gerektirdiği için burada aynı kontrolü statik yapıyoruz: iki manifestin
 * kök bağımlılıkları ve sürüm aralıkları birebir aynı olmalı, her bağımlılığın
 * da lock'ta `node_modules/<ad>` kaydı bulunmalı.
 */
describe("npm kök bağımlılıkları ile lock tutarlı", () => {
  const lockFile = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const lockRoot = lockFile.packages?.[""] ?? {};
  const tumDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };

  const alanlar = [
    ["dependencies", pkg.dependencies ?? {}, lockRoot.dependencies ?? {}],
    ["devDependencies", pkg.devDependencies ?? {}, lockRoot.devDependencies ?? {}],
  ] as const;

  it("lock kök bağımlılıkları package.json ile aynı", () => {
    for (const [ad, pjp, lck] of alanlar) {
      expect(Object.keys(lck).sort(), `lock'un ${ad} listesi package.json ile uyuşmuyor`).toEqual(
        Object.keys(pjp).sort(),
      );
    }
  });

  it("bağımlılık sürüm aralıkları birebir aynı", () => {
    const farkli: string[] = [];
    for (const [ad, pjp, lck] of alanlar) {
      for (const [ad2, aralik] of Object.entries(pjp)) {
        if (lck[ad2] !== aralik)
          farkli.push(`${ad}.${ad2}: package.json=${aralik} lock=${lck[ad2]}`);
      }
    }
    expect(farkli, "sürüm aralıkları ayrışmış").toEqual([]);
  });

  it("her bağımlılığın lock'ta node_modules kaydı var", () => {
    const eksik = Object.keys(tumDeps).filter((ad) => !lockFile.packages?.[`node_modules/${ad}`]);
    expect(eksik, "lock'ta çözümlenemiyor — npm ci burada kırılır").toEqual([]);
  });

  it("lockfileVersion 3 (npm 7+ formatı)", () => {
    expect(lockFile.lockfileVersion).toBe(3);
  });
});
