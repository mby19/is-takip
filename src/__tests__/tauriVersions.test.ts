import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

describe("Tauri sürüm tutarlılığı", () => {
  // Kaynak olarak BEYAN EDİLEN aralık değil, KİLİTLİ sürüm okunur:
  // "^2" gibi bir aralık hangi sürümün kurulduğunu söylemez.
  const npmLock = JSON.parse(readFileSync(resolve(root, "package-lock.json"), "utf8"));
  const lock = readFileSync(resolve(root, "src-tauri/Cargo.lock"), "utf8");

  const npmVersion = (name: string): string | undefined =>
    npmLock.packages?.[`node_modules/${name}`]?.version;

  const crateVersion = (name: string): string => {
    const match = lock.match(new RegExp(`name = "${name}"\\nversion = "([^"]+)"`));
    if (!match) throw new Error(`${name} Cargo.lock içinde bulunamadı`);
    return match[1];
  };

  it("@tauri-apps/api ile tauri crate'i aynı minor sürümde", () => {
    const api = npmVersion("@tauri-apps/api");
    expect(api, "@tauri-apps/api package-lock.json içinde yok").toBeDefined();
    expect(minor(api!), `api ${api} vs crate ${crateVersion("tauri")}`).toBe(
      minor(crateVersion("tauri")),
    );
  });

  it("eklenti sürümleri npm ve Rust tarafında uyuşuyor", () => {
    const pairs: [string, string][] = [
      ["@tauri-apps/plugin-sql", "tauri-plugin-sql"],
      ["@tauri-apps/plugin-fs", "tauri-plugin-fs"],
      ["@tauri-apps/plugin-dialog", "tauri-plugin-dialog"],
      ["@tauri-apps/plugin-opener", "tauri-plugin-opener"],
    ];
    for (const [npmName, crateName] of pairs) {
      const version = npmVersion(npmName);
      if (!version) continue;
      expect(
        minor(version),
        `${npmName} (${version}) ile ${crateName} (${crateVersion(crateName)}) uyuşmuyor`,
      ).toBe(minor(crateVersion(crateName)));
    }
  });
});
