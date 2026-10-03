use std::path::{Path, PathBuf};
use std::process::Command;

/// Xcode 27's SwiftPM internalizes `@_cdecl` exports in static library products:
/// `nm` shows them as local `t` instead of global `T`, so they never reach the
/// archive's symbol table and Rust consumers fail to link with "Undefined
/// symbols for architecture arm64".
///
/// swift-rs 1.0.8 tries to undo this in `globalize_cdecl_symbols()`, but it only
/// scans the package's *own* object member (`in_own_member`). The `SwiftRs`
/// module the Rust side actually calls into is a *dependency* member, so its FFI
/// entry points stay local. 1.0.8 is the newest release, so the fix lives here
/// until upstream widens that filter.
///
/// Only `libTauri.a` is touched: globalizing inside every archive would define
/// the same globals in `libTauri.a`, `libtauri-plugin-dialog.a` and
/// `libtauri-plugin-notification.a`, which trips Xcode 27's atom linker with
/// "malformed atom files with duplicate names".
const SWIFT_RS_FFI_SYMBOLS: &[&str] = &[
    "_retain_object",
    "_release_object",
    "_string_from_bytes",
    "_data_from_bytes",
];

fn main() {
    tauri_build::build();
    if is_ios_target() {
        patch_swift_archive();
    }
}

/// Build scripts are compiled for the *host*, so `cfg!(target_os)` would always
/// answer "macos" here; the target has to be read from the environment.
fn is_ios_target() -> bool {
    std::env::var("TARGET").is_ok_and(|t| t.contains("ios"))
}

/// Repair the Swift archive `tauri`'s build script produced earlier in this
/// build, and make sure it actually gets linked.
///
/// `tauri` is a dependency, so its build script (which runs the SwiftPM build)
/// has finished by the time this crate's build script executes: the `.a` exists
/// and only the final link is still ahead of us.
fn patch_swift_archive() {
    // OUT_DIR is `<target-dir>/<profile>/build/<pkg>-<hash>/out`, and tauri's
    // own build directory sits next to ours under `.../build/tauri-<hash>/`.
    let Some(build_root) = std::env::var_os("OUT_DIR")
        .map(PathBuf::from)
        .and_then(|out| out.parent().and_then(Path::parent).map(Path::to_path_buf))
    else {
        return;
    };

    let Ok(entries) = std::fs::read_dir(&build_root) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        // Tauri's own build dir only: `tauri-<hash>`, not `tauri-plugin-*`,
        // whose SwiftPM output is `libtauri-plugin-*.a` rather than `libTauri.a`.
        if !name.starts_with("tauri-") || name.contains("plugin") {
            continue;
        }
        let Some((search_dir, archive)) = find_lib_tauri(&entry.path()) else {
            continue;
        };
        println!("cargo:rerun-if-changed={}", archive.display());
        fix_archive(&archive);
        // `cargo:rustc-link-search` from tauri already reaches the linker, but
        // the matching `cargo:rustc-link-lib` does not — without `-lTauri` the
        // archive is never searched and its symbols stay unresolved. Re-emit
        // the pair so the Swift side is actually pulled in.
        println!("cargo:rustc-link-search=native={}", search_dir.display());
        println!("cargo:rustc-link-lib=static=Tauri");
        return;
    }
}

/// Locate `libTauri.a` inside tauri's SwiftPM output, returning the directory
/// the linker should search alongside the archive itself.
fn find_lib_tauri(build_dir: &Path) -> Option<(PathBuf, PathBuf)> {
    let products = build_dir.join("out/swift-rs/Tauri/out/Products");
    std::fs::read_dir(&products)
        .ok()?
        .flatten()
        .map(|config| {
            let archive = config.path().join("libTauri.a");
            (config.path(), archive)
        })
        .find(|(_, archive)| archive.exists())
}

fn fix_archive(archive: &Path) {
    let Ok(nm) = Command::new("nm").arg(archive).output() else { return };
    let stdout = String::from_utf8_lossy(&nm.stdout);

    // Promote only symbols that are still local (`t`). Already-global ones need
    // no work, and skipping them keeps the archive byte-identical so
    // `rerun-if-changed` does not ping-pong between builds.
    let mut promote = Vec::new();
    for symbol in SWIFT_RS_FFI_SYMBOLS {
        let is_local = stdout.lines().any(|line| {
            // nm prints `<address> <kind> <name>`; `t` marks a local symbol.
            let mut fields = line.split_whitespace();
            fields.next(); // address
            let kind = fields.next();
            let name = fields.next();
            let rest = fields.next();
            matches!((kind, name, rest), (Some("t"), Some(n), None) if n == *symbol)
        });
        if is_local {
            promote.push(*symbol);
        }
    }
    if promote.is_empty() {
        return;
    }

    let Some(objcopy) = llvm_objcopy() else {
        println!(
            "cargo:warning=Xcode 27 internalized swift-rs FFI symbols; run \
             `rustup component add llvm-tools` or iOS linking fails with \
             undefined symbols"
        );
        return;
    };

    let mut cmd = Command::new(objcopy);
    for symbol in &promote {
        cmd.arg(format!("--globalize-symbol={symbol}"));
    }
    cmd.arg(archive);
    match cmd.status() {
        Ok(status) if status.success() => println!(
            "cargo:warning=globalized {} Xcode 27-internalized swift-rs symbol(s) in {}",
            promote.len(),
            archive.display()
        ),
        Ok(status) => println!(
            "cargo:warning=llvm-objcopy failed on {}: {status}",
            archive.display()
        ),
        Err(e) => println!(
            "cargo:warning=could not run llvm-objcopy on {}: {e}",
            archive.display()
        ),
    }
}

/// `llvm-objcopy` from rustup's `llvm-tools` component — Xcode ships none, and
/// GNU objcopy/`strip` cannot read Mach-O.
fn llvm_objcopy() -> Option<PathBuf> {
    let sysroot = Command::new("rustc")
        .args(["--print", "sysroot"])
        .output()
        .ok()?;
    let sysroot = PathBuf::from(String::from_utf8_lossy(&sysroot.stdout).trim());
    let host = format!("{}-apple-darwin", std::env::consts::ARCH);
    let path = sysroot
        .join("lib/rustlib")
        .join(host)
        .join("bin/llvm-objcopy");
    path.exists().then_some(path)
}
