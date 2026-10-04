# Contributing to İş Takip

İş Takip is a Tauri v2 + React 19 desktop/mobile app for construction-site personnel to track
attendance, earnings and payments. Most of the data it holds is **money that a person earned and
has not been paid yet**. That is why this project is unusually strict about layering, about having a
single source of truth for money math, and about what a test is allowed to assert.

This document is not generic "open a PR" advice. It describes the rules this codebase actually
holds itself to. If a change needs to break one of them, that is fine — but explain it in the PR
and write an ADR.

## Getting set up

Requires Node.js and the [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
(Rust toolchain, platform webview dependencies). Mobile targets additionally need Android Studio /
Xcode.

```bash
npm install
npm run tauri dev     # run the app
```

| Command              | What it does                                           |
| -------------------- | ------------------------------------------------------ |
| `npm run tauri dev`  | Run the desktop app with hot reload                    |
| `npm test`           | Vitest unit/component suite (one shot)                 |
| `npm run test:watch` | Vitest in watch mode                                   |
| `npm run typecheck`  | `tsc --noEmit`                                         |
| `npm run lint`       | ESLint over `src/`                                     |
| `npm run test:e2e`   | Playwright end-to-end suite (see `docs/adr/0007`)      |
| `npm run build`      | `tsc && vite build` — typecheck plus production bundle |

A Husky `pre-commit` hook runs lint-staged, typecheck and Vitest on staged changes. If the hook
fails, fix the code — do not bypass it with `--no-verify` unless you have a concrete reason and you
mention it in the PR.

Commit messages follow [Conventional Commits](https://www.conventionalcommits.org/):
`fix(tema): ...`, `feat(takvim): ...`, `chore: ...`.

## The layering rule

```
Component → Hook → Store → Repository → lib/db.ts
```

- **Components** (`src/components/**`) render and dispatch intent. They may hold local UI state
  and they may call a hook.
- **Hooks** (`src/hooks/**`) compose stores and derived data. For shared month-shaped data there is
  already `src/hooks/useDomainMonthData.ts` — extend it instead of writing another per-screen
  variant.
- **Stores** (`src/stores/**`) hold state and delegate persistence.
- **Repositories** (`src/repositories/**`) are the only layer that talks to the database.
- **`src/lib/db.ts`** owns the SQLite connection, schema, and migrations.

**A component must never import a repository directly.** The moment two screens need the same data,
the data belongs in a hook. Screens that bypass the hook layer are the main source of duplicated
logic in this codebase's history.

## Money has exactly one source of truth

| Concern                   | File                              |
| ------------------------- | --------------------------------- |
| Daily earnings formula    | `src/utils/earningsCalculator.ts` |
| Period breakdown / totals | `src/utils/calculations.ts`       |

Do **not** copy, inline, or "quickly adjust" a calculation in a component, a hook, or a store. If a
screen needs a variant, add a parameter or a function to those files. The kuruş (cent) allocation
rule — how a remainder of one lira is distributed when a period is split by days worked — is
specified in [`docs/adr/0009`](docs/adr/0009-para-yuvarlama-ve-hakedis-esi.md). Read it before
touching anything money-related.

## Period lock is fail-closed

`isDateInClosedPeriod` treats **every** date as closed when the closed-period list cannot be read.
This is deliberate: if we cannot determine what is locked, allowing an edit risks silently changing
a payout that has already been settled.

Any change to this function must preserve fail-closed behaviour under every error path (DB failure,
parse failure, missing row). A change that makes it fail-open is a bug even if it makes tests pass.

## Testing rules

Vitest for unit and component tests, Playwright for e2e (`e2e/`).

1. **Never disable a test.** No `.skip`, no `.only`, no commenting out an assertion to get a green
   build. If a test is genuinely obsolete, delete it in the same commit as the behaviour change.
2. **Do not write tests that pin implementation detail.** Tests that assert DOM wiring, that a mock
   was called and echoed its input back, or that match on incidental markup such as `data-slot`
   attributes are _deleted in review_ — they do not protect the product, they only break on the next
   refactor. Assert behaviour, boundaries, invariants, transitions and errors instead.
3. **Verify the test actually measures the behaviour.** This project shipped a weak test that
   returned the same value for every input and passed anyway. When you fix a bug, do the mutation
   check: revert your fix and confirm the new test fails. If it still passes, the test is wrong, not
   the fix.

## Architecture decisions

Architectural decisions are ADRs in [`docs/adr/`](docs/adr/), numbered and immutable once merged —
a new decision supersedes an old one rather than editing it. Decisions not yet made are tracked in
GitHub Issues. Touching a layer boundary, the schema, the
audit system, or the money math? Write or supersede an ADR in the same PR.

## Reporting security issues

**Do not open a public issue for a security vulnerability.** Report it privately as described in
[`SECURITY.md`](SECURITY.md). Public issues are fine for ordinary bugs — please use the bug report
template so we get the environment details we need.

## Code of conduct

Participation is governed by [`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) (Contributor Covenant v2.1).
