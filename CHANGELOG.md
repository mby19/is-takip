# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

0.1.0 tarihlendiği (2026-09-12) sonrasında yapılan tüm geliştirme buradadır.
Bu sürüm **henüz yayınlanmadı**.

### Added

- **Money correctness** — a single rounding point (`allocateCents`) for day rows,
  day totals and period totals, so `Σ gün satırı = toplam` holds in every
  currency unit. Period earnings now resolve rates from a prebuilt index instead
  of scanning the rate history per day, worker and record
  (`docs/adr/0009`).
- **Undistributed earnings are recorded, not dropped.** When there is no active
  partner to share a profit with, the amount was previously written to no field
  at all. It is now reported in one signed field, shown in the day sheet, the
  month summary and the CSV export (`docs/adr/0009`).
- **Emoji pattern app lock** — the lock can be set with an emoji grid in addition
  to a PIN, and supports lockout and recovery PIN.
- **CSV export** of attendance and earnings, and the **month summary** screen
  with per-person and per-business breakdowns.
- **iOS target** (`docs/adr/0010`): `Info.plist` merge source, deep-link URL
  scheme registration and an App Store `PrivacyInfo.xcprivacy` manifest that are
  checked into source control so they survive project regeneration.
- **Turkish-aware sorting and search** for person names.
- **Rate change impact preview** — resolving a new rate against closed periods.
- **Payment overpayment warning** and **attendance coverage** indicators.
- **Accessibility and mobile layout work**: reduced-motion support, tap-target
  and contrast tests, and responsive mobile layouts.

### Fixed

- Period accrual showed day rows rounded to whole lira while the total came from
  the unrounded sum, so a day's column could sum to a different figure than the
  total on screen.
- Android release builds were signed with the debug keystore; signing now
  requires the real keystore secrets and fails loudly rather than silently
  downgrading.
- Backup format version 4: `worker_rate_history.id` is now included, so "undo"
  after a restore targets the right row instead of silently doing nothing.
- Reminder installation now records a signature including the time zone and the
  "today is complete" rule, and no longer attempts scheduling on desktop where
  the plugin's `cancel` command does not exist.

### Changed

- iOS data is included in the platform (iCloud / Finder) backup — there is no
  Tauri v2 API to exclude it. Recorded as finding 10 in `SECURITY_REPORT.md`.
  Android, by contrast, has `allowBackup="false"`.

## [0.1.0] - 2026-09-12

First public release. A Tauri v2 + React 19 application for construction-site personnel to track
attendance, earnings and payments, offline and on-device.

### Added

- **Desktop application** (Tauri v2 + React 19 + Vite + Tailwind v4 + Zustand), with an on-device
  SQLite database — no server, no network dependency.
- **Earnings tracking**, per person and shared across the crew: daily rates, attendance-based
  puantaj, and period breakdowns with a single source of truth in
  `src/utils/earningsCalculator.ts` / `src/utils/calculations.ts`.
- **Audit log with undo** — every mutation is recorded with before/after values and can be reverted
  as one atomic operation.
- **Period lock** — closed periods refuse edits, fail-closed so an unreadable lock list treats every
  date as closed (see `docs/adr/0006`).
- **Daily reminder notifications** with notification actions and an app shortcut
  (`docs/adr/0008`).
- **App lock** (PIN) protecting access to the app on a shared device.
- **Backup and restore** — export a JSON snapshot, import it back with schema repair.
- **PDF reports** of attendance and earnings.
- **Android target** with an on-device database.
- **Calendar view** with in-cell point entry, week summaries, initial-letter columns, per-person
  colors and labels, row density control and overflow warnings.
- **Theming** — dark default theme, three additional themes, contrast fixes.
- **Test infrastructure** — Vitest unit tests and Playwright end-to-end tests
  (`docs/adr/0007`).
- **Schema repair on startup**, which recovers a corrupted points table.

### Fixed

- Recovery of the puantaj table that schema repair had broken.
- Correctness of period accrual and data-safety regressions.
- Tauri npm and Rust versions aligned; build drift covered by a test.
