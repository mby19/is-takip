# Security Policy

İş Takip (is-takip) is a local-first Tauri v2 desktop/mobile application for tracking
construction-site worker attendance, production, and payroll. All data is stored in a
SQLite database **on the user's own device**. The project is maintained by a single
maintainer on a best-effort basis.

This document explains how to report a security vulnerability, what happens after you
report one, and which versions receive security fixes.

---

## Supported Versions

Security fixes are shipped only to the latest release. There is no long-term support
branch.

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

Older releases are not patched. If you are running an older build, please upgrade —
the data format is migrated automatically on first launch.

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for a security vulnerability.** A public
issue notifies everyone, including people who will misuse the information before a fix
exists.

Report it through **GitHub Private Vulnerability Reporting**:

1. Go to the **Security** tab of this repository.
2. Click **Report a vulnerability**.
3. Describe the issue.

> **Repository owner:** private vulnerability reporting must be enabled under
> _Settings → Security → Advanced Security_. If the button is missing, that setting is
> not on yet.

If you would rather not use GitHub's reporting flow, use the email address published
on the maintainer's GitHub profile instead. Do not post the details in an issue, a
discussion, or a pull request.

### What to include

The more precise the report, the faster it can be assessed. Useful details:

- **Affected version** (shown on the app's about screen) and platform (macOS, Windows,
  Linux, Android, iOS).
- **What the vulnerability allows an attacker to do**, and what access they need
  (physical access to an unlocked device, access to an exported backup file, etc.).
- **Steps to reproduce**, or a proof of concept.
- Whether any user data is involved: payroll records, worker names, payment history.
- Whether the issue is already public anywhere.

Please do **not** include real personal data in a report. Synthetic or redacted
records are sufficient.

### What to expect

This is a single-maintainer open-source project, so responses are best-effort:

| Stage                  | Target                                             |
| ---------------------- | -------------------------------------------------- |
| Acknowledgement        | Within 7 days                                      |
| Initial assessment     | Within 30 days                                     |
| Fix or mitigation plan | Within 90 days                                     |
| Public disclosure      | Coordinated with the release that contains the fix |

If a report is accepted, please keep it confidential until a fix has shipped. If the
90-day window passes without a fix, you are free to disclose — please open an issue
noting that the disclosure was coordinated through this policy.

A fix may require a design decision (for example, key storage) that cannot be resolved
in a single release. In that case the maintainer will say so rather than go silent.

### Safe harbor

Good-faith security research is welcome and will not be pursued legally, provided that:

- You use a test account and synthetic data only.
- You do not access data belonging to other people.
- You do not degrade availability or corrupt data for other users.
- You do not disclose the issue publicly before a fix or the agreed-upon deadline.

---

## Scope

### In scope

- Data belonging to one user being exposed, altered, or deleted without their consent.
- Code execution or sandbox escape in the Tauri webview.
- SQL injection, path traversal, or content-security-policy bypass.
- Personal data (worker names, payroll amounts, national ID numbers, IBANs, phone
  numbers) leaking through error monitoring or telemetry.
- Backup or restore operations that can corrupt or lose data.

### Known design limits — **not** vulnerabilities

These are documented, deliberate architectural properties. They are described in
[`SECURITY_REPORT.md`](SECURITY_REPORT.md) so that users can make an informed decision,
and they are **not** treated as vulnerabilities:

1. **The application lock is client-side and is a privacy screen, not a security
   boundary.** The lock state, its salt, and the derived hashes live in the application's
   own browser storage on the device, and the SQLite database is written unencrypted.
   Someone with filesystem access to an unlocked device can read the payroll data
   directly. This is inherent to a local desktop application built on a webview; the
   key needed to encrypt the database would have to live in the same process that the
   attacker can already read. **Users are expected to enable full-disk encryption.**
2. **The rate limiter for lock attempts is stored client-side**, so it slows down guessing
   _inside_ the app and does not stop offline guessing.
3. **The recovery PIN permanently removes the lock** rather than skipping it for the
   session.
4. **iOS: application data is included in the device backup.** Tauri v2 exposes no
   API to exclude a directory from the backup, so the mitigation is a user-side decision.
5. **Android: the on-device backup path is explicitly closed** (`allowBackup=false`
   plus the Android 11 and Android 12+ exclusion rules) — the iOS equivalent is not yet
   implemented.
6. **Exported backup files are plaintext JSON.** Users are expected to store them in an
   encrypted location.
7. **The audit log stores values in plaintext** because it is required for correct
   undo of a change.

Reporting any of these as a new vulnerability will be closed as _known and accepted_,
with a pointer to the report. Reporting them with a **concrete new impact** that is not
described there is still valuable — please include that impact.

---

## Security posture summary

What the project does do:

- **SQL injection:** every query value goes through a single escaping helper.
- **Cross-site scripting:** React escapes by default; a restrictive content security
  policy (`default-src 'self'`) is configured.
- **Path traversal:** file access is scoped to the application's download directory by
  the Tauri filesystem plugin.
- **Error monitoring:** disabled unless a DSN is explicitly configured; when enabled,
  session replay masks all text, blocks all media, disables default PII, and applies a
  second masking pass to every outgoing event.
- **Android backups:** both the legacy and the modern Android backup paths are disabled
  and covered by a regression test.

---

## Advisory and version history

`SECURITY_REPORT.md` tracks every finding with its status (resolved, open, or accepted
limit) and the date it was resolved. It is updated as part of the same change that fixes
a vulnerability.
