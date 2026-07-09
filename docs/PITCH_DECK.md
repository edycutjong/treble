# Pitch Deck — The Treble

> 12 slides + speaker notes. Visual system: canvas `#0B0E11`, pot-gold
> `#F5C542`, USD₮-green `#26A17B`, AI-cyan `#38BDF8` (reserved for the
> machine), Space Grotesk display / Inter body / JetBrains Mono for hashes.

---

## Slide 1 — Title
**THE TREBLE** — *a trustless prediction pot where an on-device AI stakes its own money against you.*
Visual: the gold pot ringed by green human seats and ONE cyan seat. Badge: "No server · No house · No cloud".
Hero metric strip: `198 tests · 100% coverage · Σ==Σ to the micro · 4 peers byte-identical · 0 cloud calls`.

> **Say:** "Every friend group runs a pot. Ours has a machine at the table — with its own wallet — and not even the machine can cheat."

## Slide 2 — The problem
Two trust problems fans actually have:
1. The pot needs a **treasurer** — someone holds the money, someone "misremembers" their pick.
2. "Could an AI out-predict us?" is unanswerable when the AI is a **cloud API with someone else's wallet**.

> **Say:** "Group pots run on trust and end in arguments. And AI trash-talk stays hypothetical because the AI never has skin in the game."

## Slide 3 — The solution
One flow: **stake → tamper-evident pick lock → human consensus → deterministic split** — with an autonomous, self-custodial AI participant.
The AI is a *player*: it reasons on your hardware, stakes under a hard cap, wins or loses like everyone else — and is provably barred from refereeing.

> **Say:** "We didn't add AI as a feature. We gave it a seat, a wallet, and strictly less power than a human."

## Slide 4 — Live demo flow
`npm run demo` beats (~20 s): stakes with receipts → the cyan seat's policy pre-flight + rationale + autonomous stake → 🔒 kickoff → Bo's edit REJECTED → the machine's vote REJECTED → Σ CHECK ✓ → CONVERGENCE ✓ → "THE MACHINE TAKES THE POT".

> **Say (during demo):** "Watch the two rejections — a human cheating, and the machine over-reaching. Every peer refuses both. That's the product."

## Slide 5 — Architecture (all three, load-bearing)
Diagram: Humans + Agent Hypercores → Autobase reducer → Hyperbee view → consensus → bond-account settlement. WDK policy engine wraps the agent wallet; QVAC tool-calling feeds the agent's pick.
Callouts: **Pear** = the trustless table · **WDK** = self-custody + the cap · **QVAC** = the on-device mind.

> **Say:** "Remove Pear, you need a server. Remove WDK, a custodian puppets the 'AI wallet'. Remove QVAC, the opponent is a datacenter. That's why this is the all-three build."

## Slide 6 — The invariant wall (why judges can trust it)
I1 pick immutability · I2 Σ payouts == Σ stakes · I3 signature-attributed authority · I4 human-quorum finality · I5 byte-identical convergence · I6 agent parity-minus-power · I7 policy-capped spend · I8 reducer-gated writer capability.
Each with its test file.

> **Say:** "We don't ask you to trust the vibe. Every rule on this wall has tests, and two of them fire visibly in every demo run."

## Slide 7 — Market & who it's for
Every tournament group chat (World Cup 2026: billions of viewers, uncountable kitchen-table pots). Wedge: the *novelty opponent* — "beat the machine" is a reason to switch from spreadsheet+Venmo. Long game: the same rails generalize to any group prediction ritual.

> **Say:** "Nobody downloads a 'trustless ledger'. They download 'can our group beat the AI'. Trustlessness is the retention, not the hook."

## Slide 8 — Why now / competitive edge
Alternatives: bookmakers (custodial, solitary), Telegram-bot pots (a server + a treasurer with extra steps), on-chain prediction markets (gas, KYC, no friends, no AI opponent). The Treble: friends-first, self-custodial, offline-capable, and the only one where the AI is a *bounded participant*.

> **Say:** "Our differentiator isn't odds — it's that the whole table, including the machine, is provably honest."

## Slide 9 — Traction & validation (built in-window)
Built June 28 → submission window, solo. 198 tests / 664 assertions (100% line/function/branch coverage) · e2e × 3 outcomes · p50 convergence 5.7 ms · agent seam p50 13.1 ms · reproducible bench + two verifiers (no-server, no-network) · 6-stage CI + CodeQL + secret scanning.

> **Say:** "Everything you just saw is reproducible on your laptop with three commands."

## Slide 10 — Roadmap
30 days: lock quorum (kill the early-lock grief), Autobase-encrypted pots, devnet-default settlement with explorer links. 60: on-chain escrow engine (closes the refuse-to-pay gap), mobile (Bare Kit). 90: multiple pundit personas per pot + season leaderboards (humans vs the machine, all season).

> **Say:** "The wallet layer's engine seam is exactly where escrow lands — the app code doesn't change."

## Slide 11 — Team
Solo build on a verified-first workflow: every SDK claim checked against installed source before use; friction logged and fed back to the sponsor teams (see docs/friction-log.md — 14 concrete items).

> **Say:** "One person, three stacks, zero invented APIs."

## Slide 12 — The ask / closer
Try `npm run demo`. Then try to cheat it.
**The Treble — humans vs. the machine, and nobody holds the cash.**

> **Say:** "We came for the treble: all three stacks, one coherent game. Thank you — and mind the machine, it's 1–0 up."
