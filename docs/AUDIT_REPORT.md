# Self-Audit — invariants, threat model, residual risk

Honest security posture of The Treble as built. We list what the system
*provably* enforces (with the tests that pin it), what it deliberately does
not solve, and who the adversaries are.

## 1. Protocol invariants (enforced in `src/core/reducer.js`)

| # | Invariant | Enforcement | Pinned by |
|---|---|---|---|
| I1 | **Pick immutability** — ≤1 pick per member; none accepted after the structural lock or with declared `ts ≥ kickoff`; backdated timestamps cannot beat the lock | reducer | `reducer.test.js` (4 tests), demo cheat beat |
| I2 | **Accounting** — `Σ payouts == Σ stakes` exactly, integer micro-USD₮, deterministic dust to lexicographically-first winners | `split.js` | `split.test.js`, `settlement.test.js`, e2e Σ CHECK |
| I3 | **Authority** — ops are attributed to the signing writer core (`node.from.key`); payload cannot impersonate | Hypercore signatures + apply wiring | `pot-p2p.test.js` |
| I4 | **Result finality** — result exists iff a strict majority of *staked humans* voted the same score; votes freeze at finality | reducer | `reducer.test.js` (6 tests) |
| I5 | **Determinism** — same linearized log ⇒ byte-identical state hash on every peer | pure reducer + canonical stringify | 3- and 4-peer convergence tests, demo CONVERGENCE line |
| I6 | **Agent parity minus power** — identical join/stake/pick rules; **no** votes, locks, or writer grants | reducer role checks | `reducer.test.js`, `agent-seat.test.js` (over the wire) |
| I7 | **Bounded agent spend** — per-tx + cumulative session caps; default-deny beyond the single ALLOW rule; simulations cannot consume budget | real `@tetherto/wdk` policy engine | `wallet.test.js` (5 tests) |
| I8 | **Capability gating** — `host.addWriter` runs only on reducer-accepted grants; an agent-granted writer never becomes writable | `src/p2p/pot.js` | the "accomplice bot" attack test |

## 2. Adversary profiles & attacks considered

- **A cheating friend** (edit pick after kickoff, double-stake, stake-less pick, vote before kickoff, settle twice, join twice): all rejected deterministically — each has a dedicated test and two appear live in every demo run.
- **A malicious AI agent** (our own code gone rogue, or a modified one): cannot vote, cannot lock, cannot invite accomplice writers (I6/I8); spend hard-capped by WDK default-deny (I7); cannot impersonate others (I3). Its worst case equals its cap.
- **An outside intruder with the invite**: can read (the invite IS the membership secret — treat it like the group chat link) but cannot write without a human grant (I8). Without the invite: cannot even discover the swarm topic.
- **A network adversary**: Hyperswarm links are Noise-encrypted; state is content-addressed and signed. Replay/reorder attacks land in the reducer, which is order-safe by construction (I5).

## 3. Residual risks (deliberate, documented)

1. **Settlement is escrowless.** Losers *owe* winners per the deterministic plan; refusal to execute your legs is possible. Mitigations today: stakes are ring-fenced at stake time in per-pot bond accounts (visible receipts), the debt record is tamper-evident and survives the refuser, and the pot is a friends-circle game. Fix path (v2): on-chain escrow contract or conditional payments; the wallet layer's engine seam (`sim` ↔ `solana`) is where it lands.
2. **Consensus collusion — including solo self-Sybil, not just a colluding majority.** A strict majority of staked humans can finalize a false score (I4 is quorum-honesty-bounded) — and because `add-writer` grants carry no per-identity cap, a **single** human can self-Sybil enough extra writer keys, stake each one, and out-vote the honest players alone; no recruiting anyone required. Money math still holds (each fake identity costs its own real stake — no free win), and the append-only dissent record makes it provable after the fact, but "colluding majority" undersells the risk. Related: agent-inferiority (I6) is only as strong as **role assignment** — the reducer trusts whatever `role` a grant op declares, so a human who runs `/approve <key> human` on a writer that self-declared `agent` hands it full human authority (votes, locks, further grants); the CLI now warns on that specific override but does not block it. No oracle by design — an AI oracle would be both fragile and a rig-the-game vector. Fix path (v2): one-seat-per-verified-identity + a harder role-assignment guarantee than an operator warning.
3. **The pick/lock concurrency window.** A pick appended causally-concurrent with the first lock may linearize on either side of it; every peer resolves it *identically* (I5), but which side is not humanly predictable in the milliseconds around kickoff. Real pots converge minutes before kickoff; a griefing early-lock (declared `ts ≥ kickoff` before real kickoff) is socially visible and recoverable by abandoning the pot. Fix path: lock quorum (m-of-n locks required). We hit this window empirically in integration tests — the deterministic reducer held; the tests now model the real-world convergence barrier.
4. **Sim engine scope.** The default settlement ledger is local and per-process — disclosed everywhere it appears. It exists so judges/CI can verify the *entire* flow offline; the WDK policy engine governing it is the real one. Cross-device value truth requires the real-chain engine.
5. **Beta dependency.** `@tetherto/wdk@1.0.0-beta.12` is pinned; policy semantics were verified against the installed source (see friction log), not assumed.
6. **Invite secrecy = privacy boundary.** Anyone holding the invite can read pot history. Autobase-level encryption keys per pot are a v2 hardening.
7. **Cumulative spend cap trusts a caller-supplied address hint.** `withinCaps` (`src/wallet/index.js:64`) reads cumulative spend as `ledger.spent(params.__address)`, where `__address` is injected by our own `stakeBond`/`simulateStake` wrapper — not derived independently by the policy engine. The **per-tx** cap (`amount > perTxCap`) is intrinsic to the transfer amount and cannot be evaded this way; but our stated threat model includes "a modified [agent]" as an adversary, and a modified agent calling the exposed `account.transfer(...)` directly (bypassing the wrapper) with a different or absent `__address` would evade the **session** cap specifically, across pots. Blast radius stays bounded by the per-tx cap either way. Fix path (v2): derive the spend key from the account/context WDK's policy engine already has, not a caller-supplied field.

## 4. What we did NOT claim

- No mainnet/devnet transactions are claimed until hashes are in the README (the readiness gate fails on placeholder hashes).
- The heuristic brain is never presented as an LLM — it is labeled `[brain: heuristic]` in every surface, and the QVAC path is the same seat code.
- "Trustless" means: no treasurer, no server, tamper-evident history, machine-checkable settlement obligations — **not** "cryptographically impossible to be a bad friend" (see §3.1–3.2).

## 5. Findings from the 2026-07-03 self-audit (all fixed, with regressions)

A full audit pass (cold-clone judge path + adversarial re-read + claims
review) after the initial build found and fixed:

| # | Severity | Finding | Fix |
|---|---|---|---|
| F1 | HIGH (demo) | The documented decline variant (`demo --buy-in 50 --cap 20`) crashed with a timeout instead of showing the agent declining | demo now narrates the on-ledger decline and the humans play on; asserted as e2e scenario 4 |
| F2 | MED (UX/honesty) | CLI session printed ✓ for reducer-REJECTED ops (e.g. `/pick` after lock) | `TreblePot.append` returns the reducer verdict; every surface reports acceptance honestly (regression-tested) |
| F3 | MED (safety) | An agent whose stake op lost the race with the kickoff lock would strand its bond | seat pre-checks the lock (`too-late`, zero money moved — regression-tested) and auto-releases the bond if the stake op is rejected mid-race |
| F4 | MED (judge UX) | `npm run agent` defaulted to `--brain auto`, which could trigger a ~1 GB model download on first judge contact, contradicting DEMO.md | default is the disclosed heuristic; `--brain qvac|auto` opts in |
| F5 | LOW | Notes quota hardcoded `20` instead of `LIMITS.MAX_NOTES_PER_MEMBER` | constant used |
| F6 | LOW | Docs said "700 MB" model; the verified-tool-calling default (Qwen3 1.7B) is ~1 GB; landing transcript implied the LLM brain where the demo shows the disclosed heuristic | wording corrected everywhere |

The cold clone (fresh `npm ci --omit=optional`) reproduced the full gate:
lint, 131/131 tests ×3, e2e, both verifiers, readiness — before these fixes
were even applied, confirming the packaging is judge-safe.

*(The suite has since grown via a 2026-07-08 coverage-hardening pass to its
current 198 tests / 664 asserts — the count below is what running this today
actually reproduces.)*

## 6. Reproduce this audit

```bash
npm test               # every invariant above, 198 tests (incl. audit regressions)
npm run e2e            # invariants firing across 3 full-match outcomes
npm run verify:p2p     # no-server proof (tripwired)
npm run verify:offline # on-device proof (network syscalls booby-trapped)
```
