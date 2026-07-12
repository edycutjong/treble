# Submission copy — The Treble (build edition)

> Every claim below is true of the build in this repository today. Items that
> require an action outside this repo are explicitly marked "(pending: …)" and
> `npm run check:ready` tracks them.

## Project title
**The Treble — a trustless prediction pot where an on-device AI stakes its own money against you.**

## Emotional hook (first line)
Our group pot is the best part of every tournament — but we always wondered if we could beat an AI that actually reasons about the match. Now it has its own wallet, makes its own pick, and puts its own money in the pot — and nobody, not even the AI, can cheat or hold the cash.

## Short description (≤150 chars — 133)
Serverless self-custodial prediction pot with an on-device AI pundit as a real player. No server, no house, no cloud. It can't cheat.

## Long description (~485 words)

The Treble is the group pot every fan already runs, rebuilt so nobody has to be the treasurer — and then given the twist that makes people lean in: **an on-device AI pundit joins as a real participant.**

A pot is a `treble1…` invite. Friends join over Hyperswarm — no server anywhere — and every stake, pick, vote and receipt lives on signed, append-only Hypercore logs that Autobase linearizes into one deterministic pot state. Our reducer enforces the house rules that make it trustless: one pick each, frozen at kickoff (a post-kickoff edit is rejected by every peer — we demo the attempt live); results finalized only by a quorum of *staked humans*; and a split where `Σ payouts == Σ stakes` to the micro-USD₮, dust assigned deterministically. Four peers converge to byte-identical state hashes in the demo, every run.

The machine at the table is a genuine economic actor. It reasons about the match **on your hardware** with QVAC — `completion()` tool-calling forces it to commit through a `submit_pick` tool, streaming a one-line rationale ("Backing 1-1 the draw — Argentina unbeaten in 14 competitive matches"). It then stakes from its **own WDK wallet**: its own keys, its own per-pot bond account, a real receipt on the ledger. Its autonomy is bounded by WDK's *real* Transaction Policy engine — default-deny, with one ALLOW rule for capped stakes. It pre-flights its own allowance with a policy simulation and, if the buy-in exceeds its cap, **declines the pot on the shared ledger**. It cannot vote on results, cannot lock the pot, cannot seat accomplice writers — each refusal is a tested invariant, and two of them fire visibly in every demo.

Settlement is escrowless and honest about it: at stake time every participant ring-fences the buy-in in their own bond sub-account (self-custody preserved, receipts visible); at finality every honest client executes the same deterministic plan — winners release their own bonds, losers pay winners. A refusing debtor is an explicitly documented residual risk with a tamper-evident debt trail; the wallet layer's engine seam is exactly where the v2 on-chain escrow lands.

Judges can verify rather than believe: `npm run demo` (20 s, offline, exits non-zero if Σ or convergence break), `npm run verify:p2p` (server-socket tripwires), `npm run verify:offline` (the full agent flow with networking disabled at the syscall level), `npm test` (**198 tests, 664 assertions**, 100% line/function/branch coverage — `npm run coverage`), `npm run bench` (p50 convergence 5.7 ms, agent pick→ledger 13.1 ms, methodology printed). The demo's settlement engine is a disclosed local sim so everything runs offline; the CI/demo fallback brain is a disclosed deterministic heuristic — the QVAC LLM path is one flag (`--brain qvac`) through the identical seat, policy and ledger code.

Every stack is load-bearing: remove Pear and you need a server; remove WDK and a custodian puppets the "AI wallet"; remove QVAC and the opponent is a cloud API. That's why this is the all-three build.

## Why ONLY Pear + QVAC + WDK (platform-use blurb)
Autobase/Hypercore make the pot trustless and the AI *just another writer*; WDK gives every participant — human and machine — self-custody, and its default-deny Transaction Policies are the agent's hard cap (`PolicyViolationError` and all); QVAC's on-device `completion()` tool-calling makes the pick a genuine local decision (offline-verified). Take any one out and The Treble is impossible. Honest limits: escrowless settlement, consensus collusion, wdk beta, disclosed sim/heuristic defaults — see docs/AUDIT_REPORT.md.

## Demo video script (≤3 min) — matches `npm run demo` beats
1. **0:00–0:20** Hook over the pot table: "Our pot, but there's an AI at the table — with its own wallet. And it can't cheat." Badges: no server · no house · no cloud.
2. **0:20–0:55** Humans stake: three wallets, three receipts, three hidden picks; invite = the room (Hyperswarm), ledger = Autobase.
3. **0:55–1:40** The machine's move: policy pre-flight ALLOW → on-device rationale streams → **autonomous stake, own receipt**. Show the cap: rerun with `--buy-in 50 --cap 20` → the agent declines on-ledger.
4. **1:40–2:15** Kickoff lock: Bo's edit rejected by every peer; the machine tries to vote the result — rejected, `agent-has-no-result-authority`.
5. **2:15–2:45** Consensus → settlement legs with receipts → `Σ paid == Σ staked ✓` → `4 peers byte-identical ✓` → "THE MACHINE TAKES THE POT · Humans 0 – 1 AI Pundit".
6. **2:45–3:00** "198 tests, 100% coverage. Two verifiers. Apache-2.0. Built in-window on all three stacks — thanks for reviewing."

**Demo video:** https://youtu.be/-Bdo28WMwmc (YouTube, unlisted, ≤3 min)

## Screenshots
Pot table with the cyan AI seat + rationale bubble · the autonomous-stake card with receipt + cap meter · the kickoff-lock rejection in the ledger rail · settlement with `Σ` strip and "Humans 0 – 1 AI Pundit". (Sources: `pear run .` demo mode; design references in `../designs/`.)

## Track / category
**All three — Pear × QVAC × WDK** (Cup Champion play). If the form forces one track: **Pears** (the runtime everything sits on), with the all-three case in the description.

## DoraHacks form fields (Rules — "Submitting a Project")
| Field | Value |
|---|---|
| Product name | The Treble |
| Brief description | the ≤150-char line above (133 chars) |
| Track | all three; single-track fallback per above |
| Nation represented | (pending: set by the team at form submission) |
| Teammates + backgrounds | (pending: team lists members on the DoraHacks project page — required for eligibility) |
| Team location | (pending: set at form submission) |
| Public GitHub repo (Apache-2.0) | ✅ https://github.com/edycutjong/treble |
| Platform-use blurb | the "Why ONLY" section above |
| Demo video (≤3 min, YouTube unlisted) | ✅ https://youtu.be/-Bdo28WMwmc |

> Payout note: prizes require passing Tether KYC + sanctions screening (Terms of Participation).

## Quality gates (workflow §5.5)
- [x] Emotional hook is one group's real experience, not a tagline
- [x] NOT the docs example — "a policy-capped, self-custodial AI participant in a trustless pot" appears in no tutorial
- [x] "Why ONLY" defends all three stacks with named APIs and code locations (SPONSOR_DEFENSE.md)
- [x] Honest limitations stated (escrowless gap, collusion, beta, disclosed sim/heuristic)
- [x] Benchmark linked with p50/p95 + methodology (`npm run bench`)
- [x] Exact test count stated and machine-verified (198 — `npm run test:count`); coverage gated at 100/100/100 (`npm run coverage`)
- [x] Scope = ONE core flow; results by human consensus, never an AI oracle
- [x] Prior work disclosed (sibling specs/builds The Kitty & PunditPay; qvac-examples lineage; OSS deps)
- [ ] Repo: github.com/edycutjong/treble · Video: https://youtu.be/-Bdo28WMwmc
- [x] Personal sign-off below

## Sign-off
Thank you for reviewing The Treble. We wanted to know if we could out-pick a machine that reasons about football — so we gave it its own wallet and a seat at our pot, and made sure not even it could cheat. Building it on all three stacks isn't a stunt; it's the only way the sentence above can be true.
