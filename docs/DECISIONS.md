# Decision Log

## 2026-07-03 — License: Apache-2.0, not the workflow's MIT default
**Context**: enhance-project workflow defaults to MIT; hackathon Rules §5 mandate Apache-2.0 public repos.
**Decision**: Apache-2.0 everywhere (LICENSE, package.json, readiness check enforces it).
**Rationale**: hackathon rules override internal workflow defaults.

## 2026-07-03 — Build standalone in `build/`, not by copying sibling repos
**Context**: the spec frames The Treble as a fusion of The Kitty + PunditPay; those sibling builds exist separately.
**Decision**: implement the fused design fresh in this repo (shared design lineage, no code copied), structured as core/p2p/wallet/agent seams.
**Rationale**: a self-contained repo is judge-runnable and cleanly licensable; disclosure covers the lineage honestly.

## 2026-07-03 — Escrowless settlement with per-pot bond sub-accounts
**Context**: "the pot holds money" implies a custodian, which the whole pitch forbids; on-chain escrow is out of scope for the window.
**Options**: (a) creator escrow (a treasurer with extra steps), (b) pure IOUs (no stake-time money movement, weak demo), (c) stake-time ring-fencing into each player's own bond sub-account + deterministic loser-pays-winner legs.
**Decision**: (c).
**Rationale**: real stake-time receipts, self-custody preserved, Σ-checkable settlement; the refuse-to-pay gap is documented as residual risk with the escrow engine as v2 (the wallet engine seam is where it lands).

## 2026-07-03 — Agent cap enforced by WDK's real policy engine, not custom code
**Context**: the installed `@tetherto/wdk@1.0.0-beta.12` ships the full Transaction Policy engine (default-deny, simulate, PolicyViolationError).
**Decision**: register real policies (ALLOW capped stakes + explicit DENY for attribution); pipe the sim settlement engine through a custom `WalletManager` built on `@tetherto/wdk-wallet` base classes so the real engine governs it.
**Rationale**: "genuine use of the platform" judging criterion + strictly stronger guarantees than homemade caps. Cumulative cap reads executed ledger transfers so `simulate.*` can't drain budget.

## 2026-07-03 — Disclosed deterministic heuristic as the default demo/CI brain
**Context**: LLAMA 3.2 1B is a multi-hundred-MB first-run download; CI and the 20-second judge demo can't depend on it. QVAC track rules forbid cloud AI (irrelevant — we use none).
**Decision**: two brains behind one `submit_pick` decision boundary; heuristic labeled `[brain: heuristic]` on every surface; `--brain qvac` runs the real on-device LLM through identical seat/policy/ledger code; `@qvac/sdk` kept as optionalDependency and CI installs `--omit=optional`.
**Rationale**: honesty (never present heuristic output as LLM), reproducibility, and a real QVAC path one flag away.

## 2026-07-03 — Roles live on writer GRANTS; joins cannot self-upgrade; agents get parity-minus-power
**Context**: if the join op declared its own role, a modified agent could claim "human" and vote.
**Decision**: `add-writer` carries the role (granted by a human); `join` inherits it; reducer rejects agent votes/locks/grants; `host.addWriter` runs only on reducer-accepted grants.
**Rationale**: the no-AI-oracle guarantee must hold against a *malicious* agent binary, not just ours. Attack-tested over real replication.

## 2026-07-03 — Kickoff lock = declared-ts rule + structural lock op (belt and braces)
**Context**: deterministic reducers can't read wall clocks; declared timestamps can lie.
**Decision**: picks need declared `ts < kickoff` AND to linearize before the first accepted `lock` (lock requires human member + `ts ≥ kickoff`).
**Rationale**: backdated picks die on the structural cut; early-lock griefing is socially visible and documented (lock quorum = v2). The concurrency window around the cut is documented in AUDIT_REPORT §3.3 after we hit it empirically in tests.

## 2026-07-03 — Integer micro-USD₮ everywhere; deterministic dust
**Context**: float money in consensus state = divergent hashes eventually.
**Decision**: safe-integer micro units, canonical stringify for hashing, dust assigned 1µ at a time in ascending id order.
**Rationale**: byte-identical convergence is a headline claim; it must survive division.

## 2026-07-03 — In-process replication streams for tests/demo/verifiers; Hyperswarm for live sessions
**Context**: CI has no DHT access; judges need the offline story anyway.
**Decision**: tests/demo/bench pipe `corestore.replicate()` streams directly (same wire protocol); `create`/`join`/agent use real Hyperswarm; `verify:p2p --swarm` exercises the live DHT when a network exists.
**Rationale**: everything provable offline is proved offline; nothing pretends to be networked when it isn't (peer counts labeled).
