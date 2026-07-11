# The Treble — Judge's Reading Guide

*A trustless prediction pot where an on-device AI stakes its own money against you — and is provably unable to cheat.* One command runs everything: `npm install && npm run demo` (no keys, no faucet).

All links below are **commit-pinned** to [`1533d47`](https://github.com/edycutjong/treble/tree/1533d47160654eaa48ab3f07a756636bd513605a) (the v1.1.0 release) so the line numbers never drift.

The Treble uses the **whole Tether stack in one system** — QVAC (mind) · WDK (money) · Pears (the pot). The design thesis is *subtraction*: the AI pundit is a first-class player with **strictly less** authority than the humans. Two independent layers enforce that, and one end-to-end test attacks it.

---

## Part A — The parts I'm proud of (start here)

### 1. The centerpiece: the AI *cannot* cheat — enforced twice, attacked once

The pundit can stake and pick like anyone; it **cannot** vote on the result, lock the pot, or seat an accomplice. That isn't a promise — it's enforced at two layers that don't trust each other:

**Layer 1 — the deterministic consensus reducer** (pure function; same linearized log ⇒ byte-identical state on every peer):
- [The I1–I6 invariant contract](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/core/reducer.js#L8-L19) — the threat model in 12 lines; **I6** = agent parity with strictly-less authority.
- [`applyAddWriter` → `AGENT_CANNOT_ADD`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/core/reducer.js#L109-L118) — the agent can't seat a second bot (line 113).
- [`applyLock` → `AGENT_CANNOT_LOCK`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/core/reducer.js#L156-L164) — the agent can't freeze the pot early (line 159).
- [`applyVote` → `AGENT_CANNOT_VOTE` + human-only quorum](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/core/reducer.js#L166-L199) — no AI oracle; only a strict majority of **staked humans** can finalize a score (line 169 + the tally at 176–197).

**Layer 2 — the P2P capability gate.** Even if the reducer had a bug, base-level write capability is only ever granted on a *reducer-accepted* op:
- [`applyNodes` — `host.addWriter` runs ONLY when `event.ok && type === ADD_WRITER`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/p2p/pot.js#L183-L194) — a rejected agent grant never becomes a real writer (the [security note](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/p2p/pot.js#L8-L11) explains why).

**The attack test** — not a unit stub; the agent actually appends a `vote` op **over real Hyperswarm replication** and every honest peer rejects it:
- [`seat: agent cannot vote even after playing (over the wire)`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/test/agent-seat.test.js#L209-L241) — asserts the vote is rejected by every peer with reason `agent-has-no-result-authority`, and the result stays `null`.
- Unit mirrors: [can't add](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/test/reducer.test.js#L71) · [can't lock](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/test/reducer.test.js#L190) · [no result authority](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/test/reducer.test.js#L214-L219).

### 2. The agent seat — bounded autonomy, pre-flighted on the ledger
- [`AgentSeat.play()`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/agent/seat.js#L57-L140) — join → **policy pre-flight** → think → bond → stake → pick, with every rejection handled honestly (bond released, said so on the ledger).
- [The pre-flight decline](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/agent/seat.js#L76-L85) — the agent *simulates its own stake against its own Transaction Policy* and declines pots it can't afford, leaving a note on the pot rather than failing silently.

### 3. Determinism & settlement (the money adds up)
- [Canonical `stableStringify` + `stateHash`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/core/canonical.js#L8-L39) — how 4 peers prove they hold byte-identical state.
- [`settlementPlan` — escrowless, deterministic, Σ payouts == Σ stakes](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/core/settlement.js#L19-L60) — winners self-release their bond, losers pay remainders matched greedily in id order; two guards make an imbalance *impossible* to settle (lines 53, 56).
- Proof: [full stake→pick flow converges to identical hashes](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/test/pot-p2p.test.js#L112) · [three peers — humans and the machine on one ledger](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/test/pot-p2p.test.js#L159) · [every winner made exactly whole](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/test/settlement.test.js#L27).

---

## Part B — The Tether stack: why chosen · how wired · trade-off accepted

### 🧠 QVAC — the on-device mind *(my track)*
**Why.** "AI plays too" is only real if the machine forms a *genuine local opinion* — not a cloud API with someone else's key. QVAC gives on-device inference with tool-calling, so the pick is a real decision made on the same laptop, zero cloud calls.

**How.** [`formPickQvac`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/agent/brains/qvac.js#L67-L132) drives `@qvac/sdk` `loadModel` → `completion({ stream, tools })` and consumes the **`toolCallStream`** where the parsed [`submit_pick` tool](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/agent/brains/qvac.js#L17-L31) surfaces — a JSON-schema tool is the *only* decision boundary, so the seat can't tell the real brain from the fallback. `modelConfig.tools: true` is mandatory (without it the addon disables the tool grammar and the model just narrates prose — noted at the call site).

**Trade-off.** [Qwen3 1.7B over Llama 3.2 1B](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/agent/brains/qvac.js#L8-L13): I verified on-device that 1B-class models narrate instead of emitting well-formed `submit_pick` calls, so I paid ~700 MB more model for tool-call reliability. And because a ~1 GB download can't gate a 20-second demo, there's a **disclosed** deterministic fallback brain behind the *identical* `submit_pick` boundary; the real LLM is one flag away (`--brain qvac` / `TREBLE_QVAC_MODEL`) through the same seat/policy/ledger code. Honest disclosure over a fake-fast demo.

### 💸 WDK — self-custody for humans *and* the machine *(outside my track)*
**Why.** Every participant — including the AI — must hold their own keys and stake their own money, and the agent must be autonomous yet **bounded**. WDK gives self-custodial wallets plus a real Transaction-Policy engine, so "bounded autonomy" is enforced by the wallet, not by my app code.

**How.** [`createTrebleWallet`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/wallet/index.js#L19-L137): `new WDK(seed)` + `registerWallet`, and for agents a [`registerPolicy`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/wallet/index.js#L53-L87) with an **ALLOW** rule (bounded USD₮ transfer within per-tx + session caps) *and* an **explicit DENY** rule (so a blocked stake reports *which* policy refused it) layered on WDK's default-deny. The agent [`simulate.transfer`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/wallet/index.js#L116-L119)-pre-flights every stake; buy-ins are ring-fenced in [per-pot bond sub-accounts derived from the same seed](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/wallet/index.js#L109-L146) (self-custody preserved). The engine is swappable: disclosed sim ledger for CI, real [`@tetherto/wdk-wallet-solana` on devnet](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/wallet/index.js#L32-L48).

**Trade-off.** WDK policy conditions *also* run during simulation, so a naive cumulative counter would double-count pre-flights and drain the session budget. Fix: the cap [reads **executed** transfers from the settlement ledger](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/wallet/index.js#L61-L65), so simulations never consume budget. Accepted residual risk: the settlement "refuse-to-pay" gap (a dishonest peer could decline its legs) is *documented, not hidden* — the debt record stays tamper-evident either way.

### 🍐 Pears / Holepunch — the serverless, tamper-evident pot *(outside my track)*
**Why.** No server, no house, no cloud — and the AI must be *just another writer* with no privileged position. Holepunch gives a multi-writer, end-to-end-encrypted P2P ledger where the invite string *is* the room.

**How.** [`TreblePot`](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/p2p/pot.js#L55-L67): Corestore → **Autobase** (multi-writer linearization) → Hyperbee view, with the [deterministic reducer as the *only* thing that mutates the view](https://github.com/edycutjong/treble/blob/1533d47160654eaa48ab3f07a756636bd513605a/src/p2p/pot.js#L183-L194); Hyperswarm joins the pot topic over Noise-encrypted connections. The AI writes through the exact same Autobase path as a human — its power is reduced *only* by the reducer's role checks.

**Trade-off.** Causal concurrency at kickoff: a pick appended concurrently with the lock can linearize on either side. The reducer is deterministic either way, so peers still converge to one hash; I modeled the real-world "converge before kickoff" barrier and documented a lock-quorum fix as residual risk — choosing deterministic-either-way correctness over the complexity of a distributed lock inside a hackathon window.

---

## Engineering harness (verify the claims)
- **198 tests / 664 assertions, 100% line/function/branch coverage** on `src` — `npm run coverage`
- **E2E**: 4-peer demo × 4 scenarios with built-in Σ / convergence assertions — `npm run demo`
- **Tripwire verifiers**: `npm run verify:p2p` (server sockets booby-trapped) · `npm run verify:offline` (network syscalls booby-trapped) — proves *no server, no cloud*
- **Benchmarks**: `npm run bench` — convergence p50 5.7 ms / p95 7.0 ms (methodology printed)
- **CI/CD**: 6-stage GitHub Actions (quality matrix → TruffleHog + audit → build verify → e2e → bench → gate) + CodeQL + Dependabot
