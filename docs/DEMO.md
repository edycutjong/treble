# DEMO.md — exact steps & expected outputs

Three ways to see The Treble work, from zero-setup to fully live.

## 1. The 20-second match (judges start here)

```bash
npm install
npm run demo
```

**What you will see, in order** (all offline; four real Autobase peers in one process):

1. `🏆 pot opened "Kitchen Table Clásico"` with a real `treble1…` invite.
2. Ana / Bo / Cai stake 20 USD₮ each — every stake shows a `sim0x…` settlement receipt and their pick.
3. `🤖 THE GAFFER` — the agent's **policy pre-flight: ALLOW** (that is `@tetherto/wdk`'s real policy engine simulating the transfer), a one-line rationale labeled `[brain: heuristic]` (disclosed — see §4 for the LLM brain), and an **autonomous stake with its own receipt**.
4. `🔒 KICKOFF` then `🚫 Bo tried to change his pick after kickoff → REJECTED` — the kickoff-lock invariant firing live.
5. `🚫 the machine tried to vote on the result → REJECTED (agent-has-no-result-authority)` — the no-AI-oracle invariant firing live.
6. Settlement legs with per-transfer receipts, then the two lines that matter:
   - `Σ CHECK paid 80 USD₮ == staked 80 USD₮ ✓`
   - `CONVERGENCE 4 peers … ✓ byte-identical everywhere`
7. Final wallet table: the winner up, everyone else exactly one buy-in down.

Variants: `npm run demo -- --outcome humans` (a human wins) · `--outcome refund` (nobody called it — full refund) · `--buy-in 50 --cap 20` (the agent **declines** a pot above its Transaction-Policy cap, records the decline on the shared ledger, and the humans play on — this variant is asserted in CI as e2e scenario 4).

Expected runtime: ~15–25 s. Exit code 0. If either Σ or convergence broke, the demo itself exits non-zero.

## 2. Live multi-terminal pot (real Hyperswarm)

Terminal A (you):
```bash
node src/cli.js create --buy-in 20 --kickoff-mins 2
# prints:  invite: treble1…       ← copy it
# then a REPL: /status /stake /pick 2-1 /lock /vote 2-1 /settle /approve …
```

Terminal B (a friend, or you on another machine — same LAN not required):
```bash
node src/cli.js join <invite> --label Bo
```
→ Terminal A shows `🙋 seat request: "Bo"` — approve with `/approve <key8>`. Then both `/stake` and `/pick`.

Terminal C (the machine):
```bash
npm run agent -- <invite>            # disclosed heuristic brain by default
npm run agent -- <invite> --brain qvac   # real on-device LLM (downloads Qwen3 1.7B on first run)
```
→ Terminal A shows `🙋 seat request: "The Gaffer" … as AI PUNDIT` — approve it. The agent pre-flights its policy, thinks, stakes, and prints its receipt. After your `/lock` (once kickoff passes) and matching `/vote`s from a quorum of staked humans, everyone runs `/settle`; the agent settles itself and prints whether it won.

Desktop UI: `pear run .` (Pear runtime) — same flows with the pot table, the cyan AI seat, and the live ledger rail; the ▶ button runs the in-window table demo.

## 3. Prove the claims

```bash
npm run verify:p2p       # convergence + tripwires: zero server sockets ever opened
npm run verify:offline   # FULL agent flow with networking disabled at the syscall level
npm test                 # 198 tests / 664 assertions (100% coverage: npm run coverage)
npm run bench            # p50/p95 with methodology, writes bench-results.json
```

Expected tails: `verify:p2p ✓ — multi-writer state converged with no server anywhere` and `verify:offline ✓ — reasoning, policy, staking, consensus and settlement all ran with networking disabled`.

## 4. Notes on honesty

- The default settlement engine is a **disclosed local sim ledger** (`engine: sim` everywhere it appears) so the entire flow — including WDK policy enforcement — is verifiable offline. `--engine solana` switches to `@tetherto/wdk-wallet-solana` on devnet (fund the printed address first).
- The default demo brain is a **disclosed deterministic heuristic** (`[brain: heuristic]`) so CI and quick runs need no model download. `--brain qvac` runs the real on-device LLM through the identical seat/policy/ledger path; `TREBLE_QVAC_MODEL=/path/model.gguf` uses a local GGUF.
- The AI **never** decides results. Only staked humans vote; the reducer rejects agent votes — you can watch it try and fail in every demo run.
