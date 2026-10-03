# Issue tracker: GitHub Issues

Issues and PRs for this repo live in **GitHub Issues**, not in local markdown
files. There is no `.scratch/` directory and nothing in it is tracked.

## Why

Local markdown issues were invisible to anyone who cloned the repo, could not be
searched, had no notification, and silently drifted out of sync with the code.
GitHub Issues gives every item a URL, a state, a label set, a comment thread and
a cross-reference from the commit or PR that closes it.

## Opening an issue

Use the repository's issue forms in `.github/ISSUE_TEMPLATE/`:

- `bug_report.yml` — anything that behaves incorrectly
- `feature_request.yml` — a new capability or a change to an existing one
- Blank issue — everything else (a question fits better in Discussions)
- `config.yml` — routes security reports to `SECURITY.md` instead of a public
  issue, and points at `CONTRIBUTING.md`

An issue is ready to be worked on when it states:

1. **What is observed** (for a bug) or **what is wanted** (for a feature)
2. **How to reproduce it** — exact steps, or the screen and the data involved
3. **Why it matters** — who is blocked and what it costs them
4. **The relevant files**, when the reporter knows them

Do not open an issue to discuss a solution that has already been decided in an
ADR. Link the ADR instead.

## Labels

Three type labels, applied to every issue:

| Label           | Use for                                              |
| --------------- | ---------------------------------------------------- |
| `bug`           | Existing behaviour is wrong                          |
| `enhancement`   | New capability, or an improvement to an existing one |
| `documentation` | Wrong, missing or unclear documentation              |

Plus one triage label from `triage-labels.md`, which maps the five canonical
roles onto the label strings actually used here. Add
`good first issue` when the fix is genuinely small and self-contained, and a
component label (`ui`, `storage`, `pdf`, `mobile`, `build`) when the issue is
confined to one area.

## Triage

New issues get `needs-triage` and stay there until a maintainer has read them.
The maintainer then does one of three things:

- **Close** with `wontfix` and a sentence saying why. An unexplained close is
  worse than a rejection.
- **Request information** with `needs-info` and ask the specific question that
  is blocking. Wait for the reporter; do not guess on their behalf.
- **Accept** by applying `ready-for-agent` or `ready-for-human` and, if it is
  agent-sized, linking the issue from the next milestone or the project board.

`ready-for-agent` is a commitment: the issue must be specified enough to be
implemented without asking a question. If you cannot write the acceptance
criteria from the issue alone, it is `ready-for-human`, not `ready-for-agent`.

Discussion belongs in the issue's comment thread. Do not start a second issue to
continue a conversation — close one as a duplicate and cross-reference.

## Planning into a release

1. Milestones are named after the release they ship in (`v0.3.0`). The
   milestone description links the issues it contains; the issues do not link the
   milestone back.
2. `CHANGELOG.md` is written from closed issues at release time, under the
   version heading, grouped as **Added / Fixed / Changed**. Every entry traces
   back to an issue number so the history is auditable.
3. A PR closes its issue by writing `Closes #<n>` in the body, or by linking
   with `Fixes #<n>` from a commit. Do not close the issue by hand before the
   PR merges — the issue is the record of what shipped.
4. Anything deferred rather than rejected gets a new issue with a link to the
   one it came from. Deferred work that lives only in a closed issue is lost.

## When a skill says "publish to the issue tracker"

Open a GitHub Issue. If `gh` is authenticated, `gh issue create --title "…" --body "…"`
creates it and returns the URL; otherwise use the web form at
`https://github.com/OWNER/REPO/issues/new/choose`.

## When a skill says "fetch the relevant ticket"

Read the issue by number (`gh issue view <n>`) or by URL. Do not assume a local
file exists — there are none.
