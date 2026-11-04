---
name: progress
description: Report where the project's work stands right now - what's done, what's in progress, what's next, what the owner needs to do, and how much time is left. Use when the user types /progress or asks "where are we?" or "what's the status?".
---

# /progress

A short, verified status report in chat. It only reads; it never changes anything.

## 0. Work out the project (once per session)

Find these from the repo itself before asking anyone:

- **Repository:** the `origin` remote (`git remote get-url origin`).
- **Branches:** the default branch (`git symbolic-ref refs/remotes/origin/HEAD`), plus any integration branch PRs target (for example `staging` or `develop`; check the base of recent PRs and CONTRIBUTING or CLAUDE.md).
- **The owner's time zone:** from CLAUDE.md or the owner's earlier messages; otherwise report UTC only.
- **Where tickets live:** GitHub Issues, or local files (for example `.scratch/`, `docs/issues/`, `TODO.md`), or a tracker named in CLAUDE.md. Note how each one marks status (labels, `Status:` lines, checkboxes).
- **The project's words:** if there is a glossary (CONTEXT.md, GLOSSARY.md, docs), use its terms in the report.
- **Run log:** a notes or queue file in this session's scratchpad, if one exists.

If something isn't there, skip it.

## 1. Gather, in parallel (read-only)

- **Time.** The current time in UTC and in the owner's time zone. Look for an end time the owner set:
  - in the run log;
  - in this account's scheduled tasks, if the tools can list them (a wrap-up or summary task marks the end of a run).
- **Run log.** If there is one:
  - read its last 40 lines and its latest state snapshot;
  - find the line that records the last `/progress`, which is where "since last time" starts.
- **Code host** (GitHub, GitLab, or whatever the remote is):
  - open PRs: number, title, draft or ready, author, base branch, head SHA, the latest CI result on that head, and whether a review passed;
  - what merged into each integration branch and into the default branch since the last `/progress`, or in the last 24 hours if there's none;
  - the latest CI on each of those branches;
  - scheduled or deploy workflows that failed since then (nightly builds, publishes, releases).
- **Deploys:** if the project deploys automatically, whether the latest deploy of production and of any preview succeeded.
- **Sessions and agents:** other running sessions or agents working on this repo, if the tools can list them, with each one's task and state. Include this session's own background agents (reviews, watchers).
- **Tickets:** in progress (claimed or assigned), next (ready and unblocked), and waiting on the owner (needs-info, needs a decision, needs a human).
- **Waiting on the owner:**
  - the run log's owner to-dos;
  - those tickets;
  - PRs waiting for the owner's review or merge;
  - database migrations written but not applied, if the tools can compare them (read-only);
  - previews waiting for the owner to try.

If a source can't be reached, say so in one line and carry on.

## 2. Report in chat

Keep it to about 35 lines. Plain words, the project's glossary terms, no internal IDs. Link every PR, issue and run as a full URL.

**Where we are:** one or two sentences.

**Done since last time:** bullets, each with its link and one line on what it means for the owner or the users.

**In progress:** who is building or reviewing what, and its state (building, in review, fixing review notes, waiting for CI, waiting on X).

**Next:** the next 3 to 5 steps, in order.

**Needs you:** numbered, most important first. Each item is the exact action, with a link or path.

**Time:**
- now, in UTC and in the owner's time zone;
- the run's end and the hours left, or "no end set";
- a rough estimate in hours for what's left of the current work, labelled as an estimate.

**Links:** production, any preview the owner should try, and the latest plan or summary page, when known.

## 3. Rules

- **Read-only.** `/progress` never merges, pushes, comments, re-runs jobs, applies migrations, or messages other sessions. If something needs doing, put it under "Needs you" or "Next".
- **Verified or inferred.** Every state comes from a source read just now, not from memory. Mark anything inferred: an estimate, a guess at why something failed, a session that hasn't reported for a while.
- **Failures first.** A red CI run, a failed deploy or a failed scheduled job goes at the top of "Needs you" with its link and its first error line.
- **Afterwards,** add one line to the run log, if there is one: `- HH:MM /progress sent`. That gives the next report its "since last time".
