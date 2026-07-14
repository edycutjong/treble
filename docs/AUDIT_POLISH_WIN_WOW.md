# Polish · Winnable · Wow — Documentation Audit — The Treble

_Read as a judge reads: docs only (README, SUBMISSION.md, DEMO.md, ARCHITECTURE.md,
SPONSOR_DEFENSE.md, docs/PITCH_DECK.md, landing/index.html). Rubric: Tether Developers Cup
5×(1–5), **WDK track** (criterion 5 = real, meaningful WDK use). Team: solo, code already
built + green. Field: ~53 hackers, knockout. Time left: ~7 days, Round of 32 from Jul 7,
commit cadence watched._

> **Snapshot notice**: this review is dated **~2026-07-07**, when the suite stood at
> 131 tests / 476 asserts (quoted throughout below). The suite has since grown; the
> current, live-verified count is **198 tests / 664 asserts** (see `README.md` /
> `npm run test:count`). The verdicts and scores below still hold — only the raw
> counts have grown.

---

## 1. One-line verdict

**Winnable — a documentation set that is unusually honest and unusually complete.** The docs
already open with a real story, name every stack's load-bearing role, and disclose every
sim/heuristic fallback. The only verdict-moving gap is the set of "(pending …)" artifacts the
docs themselves flag: **video, public repo, one real devnet tx** — none of which is a writing
fix.

## 2. Disqualifier results

| # | Disqualifier | Result | Quoted line |
|---|---|---|---|
| 1 | Hard part invisible | **PASS** | README demo transcript prints `policy pre-flight: ALLOW (allow-bounded-usdt-stake)`, `autonomously staked 20 USD₮ … from its own wallet`, `Bo tried to change his pick after kickoff → REJECTED by every peer`, `CONVERGENCE 4 peers, state hash 7f01… ✓ byte-identical everywhere`. |
| 2 | Live external API on stage | **PASS** | "`npm run demo` needs no keys, no accounts, no network." + "`npm run verify:offline` … the full agent flow with networking disabled at the syscall level." |
| 3 | Needs real users/scale | **PASS** | "Four real Autobase peers … in ~20 seconds, fully offline." No network effect required. |
| 4 | Core feature only on canned input | **PASS (disclosed)** | "the demo/CI default is a **disclosed deterministic heuristic** (label `[brain: heuristic]`)" and "The default `sim` engine is a disclosed local ledger." Labeled, not hidden; judge can also "type your own pot." |
| 5 | One-sentence problem unstated | **PASS** | "every pot has the same two flaws: **someone has to hold the money**, and **someone has to be trusted not to 'misremember' their pick**." |

**No disqualifier trips.**

## 3. Scored tests A–E

### A. Shippable (2× honesty) — 10/10
The docs describe a state that already exists and was reproduced this session: `131 tests,
476 assertions`, e2e 4/4, both verifiers, lint, `check:ready`. Nothing in the docs promises
future integration on the critical path. `check:ready` itself enforces honesty: it currently
prints "READY with 2 warning(s)" — both the user-gated video + pending items. No buffer to
blow because there's no unbuilt integration described.

### B. Winnable (memorable to a tired judge) — 9/10
Quoted differentiators a judge will remember: "the AI … has *strictly less* power than
humans: no result votes, no locking, no inviting accomplices" and "Take any one out and The
Treble is impossible, not merely harder." The one archetype that out-shines on paper is a
demo that *shows a real Tether/USD₮ transaction hash* — this doc set describes real WDK
*policy* enforcement but real *settlement* is the disclosed sim by default. That's the single
memorability gap, and it's an artifact-capture task, not a docs task.

### C. Wow-factor & magic moment — Wow 9/10
The docs already contain the "oh" beat, explicitly scripted. SUBMISSION §"Demo video script"
3. **0:55–1:40**: "policy pre-flight ALLOW → on-device rationale streams → **autonomous
stake, own receipt**. Show the cap: rerun with `--buy-in 50 --cap 20` → **the agent declines
on-ledger**." That A/B (allowed vs. policy-declined, same autonomous agent) is the beat.

### D. Non-generic — 9/10
"a policy-capped, self-custodial AI participant in a trustless pot" (SUBMISSION quality gate)
is not a to-do app, chatbot, or single-API wrapper. Closest things judges have seen: a P2P
betting dApp, a local-LLM agent demo, a Holepunch chat sample — the docs pre-empt this by
citing the exact `qvac-examples` lineage and explaining why the *fusion + agent-can't-cheat
invariant* is the novelty.

### E. Documentation polish (docs as artifacts) — 9/10
- **Opening:** README leads with title/pitch/hero (badges before prose); the sharp
  problem→twist lands a screen down (§"The problem & the twist"). SUBMISSION's first line is
  the stronger hook and is correctly the submission artifact. Acceptable; the story is legible
  from the top. No rewrite required.
- **Submission gaps (all self-flagged, all user actions):** demo video "(pending: record +
  upload as YouTube unlisted)"; "Public GitHub repo … (pending: push this `build/` …)"; "Nation
  represented / Teammates … (pending)"; devnet tx hashes pending. The docs *name* every gap and
  `check:ready` gates them — exemplary honesty, but the gaps are still open until the user acts.
- **Claims vs. provable-from-docs:** the QVAC-LLM path and real-chain settlement are described
  but shown only as sim/heuristic by default — the docs say so plainly ("one flag `--brain
  qvac`", "Devnet is a config swap"). No overclaim detected.
- **Internal links checked:** DEMO.md, ARCHITECTURE.md, docs/AUDIT_REPORT.md,
  SPONSOR_DEFENSE.md, LICENSE, landing/index.html all present. No dead links in the first
  screenful; no default-template artifacts; license correctly Apache-2.0 in both LICENSE and
  package.json.

## 4. The magic moment (timestamped beat)

**0:55–1:10 of the video:** show the agent print `DECLINE` and write `🧢 declined: buy-in 50
USD₮ exceeds my Transaction Policy cap` to the ledger under `--buy-in 50 --cap 20`, then in
the normal run print `ALLOW` and `autonomously staked 20 USD₮ … from its own wallet`. The
same autonomous agent, gated then permitted by a *real WDK policy* — that is the criterion-5
"oh," and the script already places it correctly.

## 5. Action list (ranked by leverage, within ~7 days)

**(a) Make-it-true** (close a claim-vs-proof gap — all user-gated, docs already correct):
1. Record + upload the ≤3-min video to the existing script; paste the link into README badge + SUBMISSION.
2. Push `build/` as a public Apache-2.0 repo; fill repo URL + CI badge.
3. Capture ONE devnet tx (`--engine solana`, one human + one agent); paste hashes; rerun `check:ready` to clear both warnings.
4. Fill DoraHacks form fields the docs mark pending (Nation, Teammates/backgrounds, Team location).

**(b) Make-judges-care** (polish/wow):
5. In the video, hold on two frames: the `--cap 20` DECLINE line and `Σ paid == Σ staked ✓` / `4 peers byte-identical ✓`.
6. Maintain visible small commits between knockout rounds (cadence is judged).

## 6. Cut list

- No new prose sections, no extra badges pointing at a not-yet-public repo (a broken CI badge
  reads worse than none). Don't expand the honest-limitations section further — it is already
  thorough and additional caveats only dampen the pitch.
- Don't write docs for features that don't exist (leagues, escrow v2 detail beyond the one
  disclosed paragraph). Scope is correctly one deep flow.

## 7. If time is short — top 3

1. **Video** (with the DECLINE + convergence frames) — the artifact a knockout judge is most likely to consume.
2. **One real devnet tx** with hashes in the docs — the single strongest criterion-5 upgrade.
3. **Public repo + fill pending form fields**, then `check:ready` to zero warnings.

Deliberately ignore: any README rewrite (the hook is fine), any new feature docs, browser/
Lighthouse concerns (no web surface), and real-LLM capture if a model download is
impractical — the heuristic fallback is honestly disclosed and the seat/policy/ledger code is
identical across brains.
