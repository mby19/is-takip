## What changed

<!-- What is in this diff, in domain terms. List the files/behaviour, not the diff itself. -->

## Why

<!-- The problem it solves, or the bug it fixes. If this is a fix: what was wrong,
     how you found it, and why this is the correct behaviour rather than the
     behaviour the code happened to have. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor / internal cleanup (no behaviour change)
- [ ] Documentation only
- [ ] Build / CI / tooling

## Tests

- [ ] Added or updated tests — describe below what they cover and at what level
      (unit / component / e2e).
- [ ] For a bug fix: I verified the test **fails** without the fix and passes with it.
- [ ] Tests are deterministic (fake timers or explicit parameters instead of the real clock).
- [ ] No `describe.skip` / `it.skip` / `it.only` was added.
- [ ] Tests assert observable behaviour, not DOM wiring, mock echo, `data-slot`, or render counts.

Commands run locally:

```
npm run typecheck
npm run lint
npx vitest run
npm run test:e2e
```

## Architecture

- [ ] **ADR required** — see below.
- [ ] No architecture change; existing ADRs still hold.

<details>
<summary>ADR checklist — an ADR is required if you ticked any of these</summary>

- [ ] The money calculation (`src/utils/earningsCalculator.ts` / `src/utils/calculations.ts`) changed.
- [ ] A table, column or SQLite trigger was added, changed or removed (`TRIGGER_SCHEMA_VERSION` bumped).
- [ ] What is audited, and how it is reverted, changed.
- [ ] Period-lock behaviour changed.
- [ ] A new layer or a new dependency was introduced, or the layer rule was crossed.
- [ ] Backup / export format changed (migration plan included).
- [ ] A published ADR is now wrong — append an "Update (date)" note; do not rewrite the original.

Open/undecided design questions go to GitHub Discussions or Issues.

</details>

## Money and data safety

- [ ] No money formula was copied into a second place; the change lives in the single source of truth.
- [ ] `earningsRounding.test.ts` passes (or the reason it was not touched is explained).
- [ ] Any new audited table has INSERT/UPDATE/DELETE triggers, is listed in `DROP_TRIGGERS`, and `TRIGGER_SCHEMA_VERSION` was bumped.
- [ ] Revert is an UPSERT via `revertStrategies.ts`, not a manual `if` branch in `auditLogStore`.
- [ ] No real personal, financial or credential data appears in code, fixtures, or screenshots.

## Documentation

- [ ] `CONTEXT.md` updated (new file, table, column, export or command).
- [ ] `docs/adr/` updated and linked from `docs/adr/index.md` — if an ADR was required.
- [ ] `CHANGELOG.md` updated under `[Unreleased]`.
- [ ] `UBIQUITOUS_LANGUAGE.md` updated if a new domain term was introduced.

## Review notes

- [ ] The diff is scoped to one concern; no rename/move refactor stacked on unrelated fixes.
- [ ] Anything you deliberately did **not** do is written here.
- [ ] Screenshots included for any UI change.
