# AGENTS.md — The Treble (build)

Instructions for AI agents working in this repository.

## What this is
Tether Developers Cup 2026 entry: serverless self-custodial football prediction
pot with an on-device AI pundit as a bounded participant. Pear × QVAC × WDK,
all load-bearing. Deadline Jul 14 2026 23:59 UTC+1.

## Ground rules (do not violate)
1. **Apache-2.0** license — hackathon rule; never switch to MIT.
2. **No cloud AI** anywhere. QVAC on-device only; the deterministic heuristic
   brain must always be labeled `[brain: heuristic]` — never passed off as the LLM.
3. **The agent is a player, never an oracle**: reducer must keep rejecting
   agent votes/locks/writer-grants; `host.addWriter` only on reducer-accepted ops.
4. **Only earned claims** in README/SUBMISSION: test counts from
   `npm run test:count`, bench numbers from `npm run bench`, tx hashes only
   after real transactions. `npm run check:ready` is the gate.
5. **Integer micro-USD₮** in consensus state; `Σ payouts == Σ stakes` exactly.

## Commands
`npm test` (198 brittle tests — keep green) · `npm run coverage` (100% gate) · `npm run lint` (standard) ·
`npm run demo` · `npm run e2e` · `npm run bench` · `npm run verify:p2p` ·
`npm run verify:offline` · `npm run seed` (regenerates BOTH fixture files) ·
`npm run check:ready`.

## Architecture map
`src/core` pure consensus (reducer = the law) → `src/p2p` TreblePot
(Autobase/Hyperswarm) → `src/wallet` WDK facade + sim engine + policy caps →
`src/agent` brains + AgentSeat seam → `src/cli.js` + `index.html`/`app.js`
(Pear UI) + `landing/`. Tests in `test/` mirror the seams.

## Style & gotchas
- standard style (no semicolons); generated `data/fixtures/matches.js` is
  lint-ignored — edit via `scripts/seed.js` only.
- brittle: use `t.exception.all` for native error types.
- Autobase tests: tick BOTH peers' `update()`; converge before appending a
  `lock` (see AUDIT_REPORT §3.3).
- Clear timers of lost `Promise.race` branches.
- UI colors: AI cyan `#38BDF8` is reserved exclusively for the agent.
- WDK policy conditions run in simulations too — cumulative caps must read
  EXECUTED ledger transfers.
