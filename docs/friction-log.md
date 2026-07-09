# Friction log / DX report — building on Pear + WDK + QVAC

Real integration friction from this build, with resolutions — written for the
sponsor teams as actionable feedback. Everything below actually happened in
this repository's history.

## @tetherto/wdk (1.0.0-beta.12)

1. **Default-deny error carries no policy identity when nothing matches.**
   When a governed transfer merely *fails* the ALLOW condition, the thrown
   `PolicyViolationError` reports `<unknown>/<unknown>: governed-but-unmatched`
   — no `policyId`/`ruleName`. Resolution: register an explicit mirrored DENY
   rule (`deny-over-cap-stake`) so refusals are attributable in UI/logs.
   *Suggestion:* attach the nearest-missed ALLOW rule id to unmatched denials.
2. **Cumulative caps vs `simulate.*`.** Policy conditions run for simulations
   too, so closure-state "session spent" counters would be inflated by
   pre-flights. Resolution: our cumulative condition reads **executed**
   transfers from the settlement ledger instead of closure state. *Suggestion:*
   expose `context.isSimulation` to conditions.
3. **The pluggable `WalletManager` base is excellent** — building a custom
   settlement engine (`SimWalletManager`) against `@tetherto/wdk-wallet`'s
   abstract classes took under an hour and the policy engine wrapped it with
   zero extra work. This is the best part of the WDK design.
   *Nit:* `@tetherto/wdk-wallet`'s README says "internal use only" while being
   the only documented path to custom chain modules — clarify.
4. **Docs vs installed reality.** `registerWallet` passes `(seed, config)` to
   the manager constructor — matches the README, verified in source. Reading
   `node_modules/@tetherto/wdk/src/policy/constants.js` was the fastest way to
   learn the governed `OPERATIONS` set; worth surfacing in docs.

## Pear stack (autobase 7.28.1, corestore 7.11, hyperswarm 4.17)

5. **Acks need both sides to tick.** A writer's appends did not become
   visible to a peer that polled `update()` alone; convergence required the
   *writer* side to also call `update()`. Once known, trivial — but it cost a
   debugging session. *Suggestion:* a doc note on ack flushing in
   request/response-style tests.
6. **Causal concurrency is sharp around structural cut-points.** Our kickoff
   `lock` op can linearize *before* a concurrently-appended pick — that's
   correct eventual-consistency behavior, and our reducer stays deterministic
   either way, but test flakes taught us to model the real-world "everyone
   converged before kickoff" barrier explicitly. See AUDIT_REPORT §3.3.
7. **`host.addWriter` placement is a security decision.** Calling it only
   after the reducer accepts the grant op was the difference between "the AI
   can seat accomplice bots" and "it provably cannot". The Autobase docs'
   optimistic-mode warning pointed the way; an explicit recipe for
   *application-gated* writer adds would help others.
8. **Protomux channel on the replication stream** (`Protomux.from(conn)`)
   worked first try for the seat-request handshake — lovely composability.

## @qvac/sdk (0.14.0)

9. **Model weight vs CI.** The default LLM is a multi-hundred-MB first-run
   download with native backends — unusable in CI and unfriendly for a
   20-second judge demo. Resolution: `optionalDependencies` + lazy import +
   a *disclosed* deterministic fallback brain behind the same `submit_pick`
   decision boundary; CI installs with `--omit=optional`. *Suggestion:* a tiny
   (<50 MB) demo-grade GGUF constant in the SDK would make hackathon CI paths
   first-class.
10. **The full `Tool` object form (JSON-schema) is underrated** — no Zod
    dependency needed; `dist/schemas/tools.d.ts` documents it precisely.
    The `run.events` stream (`contentDelta` / `toolCall`) made wiring the
    rationale stream + the pick capture clean.
11. **Fail-fast on bad `modelSrc` is good**: pointing `TREBLE_QVAC_MODEL` at a
    nonexistent path errors quickly, which made our auto-fallback (with
    disclosure) reliable rather than hanging.

## Ecosystem/tooling

12. **brittle re-throws native error types** (`TypeError` etc.) from
    `t.exception` by design — use `t.exception.all` for validation code that
    throws TypeErrors. Cost: one confused hour; worth a bold line in its README.
13. **A lingering `setTimeout` in a lost `Promise.race` keeps the process
    alive** — our seat-grant timeout (120 s) made test runs take exactly
    +120 s until we cleared the timer in `finally`. Classic, still bites.
14. **JSON import attributes (`with { type: 'json' }`) aren't Bare-safe** —
    the Pear UI imports a generated `matches.js` twin instead; the seed script
    regenerates both from one source (CI diffs them).
15. **"Append succeeded" ≠ "op accepted."** With an application reducer on
    Autobase, `base.append()` always lands the block — acceptance is the
    reducer's verdict. Our CLI initially printed ✓ for reducer-rejected ops
    (same class of bug the sibling build's audit caught). Fix: the pot's
    `append()` now returns the reducer event and every surface reports the
    verdict. If you build app-level rules on Autobase, plumb verdicts from
    day one.
