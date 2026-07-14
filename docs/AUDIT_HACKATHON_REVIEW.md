# Hackathon Review Audit — The Treble

_Auditor: ruthless judge × shipping lead. Rubric: Tether Developers Cup (5 criteria, 1–5
each — Technical ambition, UX, Real-world utility, Creativity, Real use of chosen platform =
**WDK track**). Team: solo (Edy Cu), code already built + multi-pass audited + green. Field:
~53 registered hackers, knockout bracket. Time left: ~7 days to Jul 14 2026 23:59 UTC+1;
Round of 32 begins Jul 7 and in-window commit cadence is watched._

> **Snapshot notice**: this review is dated **~2026-07-07**, when the suite stood at
> 131 tests / 476 asserts (quoted throughout below). The suite has since grown; the
> current, live-verified count is **198 tests / 664 asserts** (see `README.md` /
> `npm run test:count`). The verdicts and scores below still hold — only the raw
> counts have grown.

---

## 1. One-line verdict

**Winnable — top-tier.** A genuinely serverless, self-custodial P2P pot with an autonomous
agent whose spend is capped by WDK's *real* default-deny policy engine, all witnessable in a
20-second offline demo. The single thing between "strong entry" and "hard to beat" is
**one real on-chain (devnet) stake receipt** to convert criterion 5 from "real engine, sim
settlement" to "real engine, real money moved" — a user action, not a code gap.

## 2. Disqualifier results

| # | Disqualifier | Result | Evidence |
|---|---|---|---|
| 1 | Hard part invisible in demo | **PASS** | The demo *shows* the hard part: `policy pre-flight: ALLOW (allow-bounded-usdt-stake)`, the streamed rationale, `autonomously staked 20 USD₮ … from its own wallet`, the post-kickoff edit `REJECTED by every peer`, `agent-has-no-result-authority`, and `CONVERGENCE 4 peers, state hash 7f01… byte-identical`. The difficult things are the visible beats. |
| 2 | Needs a live external API on stage | **PASS** | `npm run demo` "needs no keys, no accounts, no network" (README). Default brain is a disclosed heuristic; default settlement is the disclosed sim ledger. `verify:offline` runs the whole agent flow "with networking disabled at the syscall level." No third-party call is on the critical path. |
| 3 | Only impresses at scale / network effects | **PASS** | Four peers converge to a byte-identical hash in one ~20 s run; no populated marketplace or month of data needed. `verify:p2p` proves real multi-writer replication with two peers. |
| 4 | Core feature only works on canned input | **PASS (with note)** | Judge can type their own pot: `node src/cli.js create --buy-in … / join <invite>`, and `--outcome humans/refund` + `--buy-in 50 --cap 20` change the run. The match *fixtures* are canned and the default brain/engine are disclosed sims — honestly labeled, not hidden. Not a DQ, but see criterion-5 note below. |
| 5 | One-sentence problem unstated in docs | **PASS** | README line 3 + SUBMISSION: "someone has to hold the money, and someone has to be trusted not to 'misremember' their pick" — a friend-group pot with no treasurer and no trusted scorekeeper, where an AI plays with its own wallet and can't cheat. |

**No disqualifiers fire.** Step-2 scoring proceeds.

## 3. Scored tests A–E

### A. Shippability (2× integration buffer) — 10/10
It is already built, green, and audited. `npm test` → `131/131 tests, 476/476 asserts`;
`npm run e2e` → 4/4 scenarios; `verify:p2p`, `verify:offline`, `lint`, `check:ready` all
pass locally this session. There is no remaining integration to blow a buffer on. The only
open work items are **user actions** (video, public-repo push, one devnet tx), each
independent and small. Task most likely to eat time: funding a devnet account and capturing
a real `wdk-wallet-solana` transfer receipt — the engine seam exists (`src/wallet/index.js`
`engine === 'solana'`), so this is "install + fund + run," not a build.

### B. Winnability (standout in ~53) — 9/10
Lands **top 5**. The archetype that could out-shine it is a slick single-stack demo with a
polished live UI and a recorded on-chain transaction — i.e., something with a captured "real
money moved on Tether rails" beat that this repo currently expresses as a disclosed sim. The
Treble beats the field on engineering honesty and on being the only credible **all-three
fusion** where each stack is load-bearing (`SPONSOR_DEFENSE.md`, quoted APIs). It loses a
notch only for lacking a captured real-chain / real-LLM artifact in the box.

### C. Wow-factor & magic moment — Wow 9/10
Eyebrow moves inside 30 s: the AI doesn't "return a prediction," it **pre-flights its own
WDK policy, streams a rationale, and stakes its own money from its own keypair** — then
**tries to cheat and gets rejected by the reducer**. That "the machine has *strictly less*
power than the humans, enforced over the wire" beat is rare.

### D. Technical depth & non-genericness — 9/10
Not a weekend tutorial. Autobase multi-writer consensus with an invariant-enforcing reducer,
integer-exact `Σ payouts == Σ stakes` with deterministic dust, a real WDK `registerPolicy`
default-deny cap with an explicit DENY rule that reports *which* policy refused
(`src/wallet/index.js:65-82`), and agent-inferiority invariants tested over real replication
streams (incl. the "agent seats an accomplice bot" attack). Closest prior art: a P2P poker/
escrow toy, a "local LLM agent" demo, a crypto-betting dApp — it out-depths all three by
fusing them under one tamper-evident ledger. Novelty is in the *combination + the agent-can't-
cheat invariant*, not any single part.

### E. Code & documentation hygiene — 9/10
- **Mocks/shortcuts (all disclosed, none hidden):** default brain = deterministic heuristic
  (`src/agent/brains/heuristic.js`, labeled `[brain: heuristic]` in output); default money
  engine = sim ledger (`src/wallet/sim-ledger.js`); match data = fixtures
  (`data/fixtures/matches.js`). Each is explicitly labeled in code, demo output, and README
  "Honest limitations." No `if demo: return fake_data` deception, no dead buttons.
- **Demo-to-code gaps:** none material. Every README/SUBMISSION claim maps to runnable code.
  The only claims not *demonstrated by default* are the QVAC-LLM path (`--brain qvac`, needs
  a local model) and real-chain settlement (`--engine solana`, needs a funded account) — both
  flagged "(pending …)" and gated by `check:ready`.
- **Opening hook:** README first 3 lines = title + one-line pitch + hero; problem lands by
  line ~62 and the SUBMISSION hook is strong. Passes; the pitch is clear from the top.

## 4. The magic moment (timestamped beat)

**At 0:55–1:10:** the operator reruns with `--buy-in 50 --cap 20`. On screen the agent prints
`policy pre-flight: … DECLINE`, writes `🧢 declined: buy-in 50 USD₮ exceeds my Transaction
Policy cap` **onto the shared ledger**, and moves zero money — then in the normal run it
prints `ALLOW`, streams its rationale, and `autonomously staked 20 USD₮ … from its own
wallet`. That A/B — *the same autonomous agent stopped by a real WDK policy, then allowed* —
is the "oh." It is the criterion-5 proof made visible. (Secondary beat at 1:40: the machine's
result-vote is `REJECTED (agent-has-no-result-authority)`.)

## 5. Action list (ranked by leverage)

**(a) Make-it-true** (close claim-vs-proof; most are user-gated):
1. **Record the ≤3-min video** to the existing script (SUBMISSION §"Demo video script"). Highest leverage — a knockout judge may never open the code. _User._
2. **Capture ONE real devnet stake** via `--engine solana` (one human + one agent) and paste the tx hashes into README/SUBMISSION. Flips criterion 5 from "real engine / sim money" to "real money moved." _User (fund + run); code seam already present._
3. **Push `build/` as a public Apache-2.0 repo**, then fill the CI badge + repo URL. _User._
4. **Capture one `--brain qvac` run** (real on-device LLM tool-call) as a GIF/log to prove the QVAC path, not just the heuristic. _User (needs local GGUF)._

**(b) Make-judges-care** (polish/wow, reachable this window):
5. Keep visible commit cadence between rounds (judging watches it) — small honest commits (docs, tests) each round.
6. Ensure the video literally shows the `--cap 20` DECLINE beat (§4) and the state-hash convergence line; those two frames carry the win.

## 6. Cut list

- Do **not** build a fancier Pear GUI, add leagues/order-books/multi-chain, or a second
  agent strategy — all are scope creep away from the one deep flow. The CLI is the judge-proof
  path; the desktop UI is a bonus, not a dependency.
- Do not chase Lighthouse/Playwright/browser E2E — there is no browser-served app surface;
  those gates were correctly skipped.

## 7. If time is short — top 3

1. **Record + upload the video** (the DECLINE beat + convergence hash + `Σ paid == Σ staked`).
2. **One real devnet tx** (human + agent) with hashes pasted in — the single strongest
   criterion-5 upgrade available.
3. **Push the public repo** and wire the badge/URL; run `npm run check:ready` until the two
   remaining warnings clear.

Deliberately ignore: real-LLM capture if a model download is impractical (heuristic is
honestly disclosed and the seat/policy/ledger code is identical), any UI polish, and any new
feature. The build is done; the remaining value is all in *evidence capture*.
