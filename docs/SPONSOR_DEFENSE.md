# Why ONLY Pear + QVAC + WDK — The Treble (build edition)

The Treble needs all three stacks *simultaneously*: a trustless table (Pear),
self-custody for every player including a machine (WDK), and an opponent that
reasons with no cloud (QVAC). Below: every load-bearing API, **where it is
used in this codebase**, and what replacing it would cost.

## Pear (P2P state)

1. **Autobase 7** — `new Autobase(store, bootstrap, { open, apply })`, `host.addWriter`, `base.append/update/view` → `src/p2p/pot.js`. The multi-writer pot with no server; the AI is *just another writer core*. Without it: a coordination server + a CRDT you'd have to write and prove.
2. **Hypercore (via Corestore)** — per-writer signed append-only logs → authority in `reduce(state, op, { from: node.from.key })` (`src/p2p/pot.js` → `src/core/reducer.js`). Picks become tamper-evident *by construction*. Without it: a trusted timestamp server and signature plumbing.
3. **Hyperbee** — the deterministic materialized view (`state`, `event/<seq>`) with `valueEncoding: json` → `src/p2p/pot.js`. Without it: hand-rolled snapshot/undo logic that Autobase reordering would break.
4. **Hyperswarm** — `swarm.join(discoveryKey)`; the `treble1…` invite IS the room → `src/p2p/pot.js`, `src/p2p/invite.js`. Noise-encrypted transport for free. Without it: signaling servers + TLS + NAT pain.
5. **Protomux + compact-encoding** — the `treble/1/hello` seat-request channel riding the replication stream → `src/p2p/pot.js`. Without it: a second connection layer just to ask "may I sit down?".

## WDK (money + guardrails)

6. **`new WDK(seed).registerWallet(name, Manager, config)`** — the modular manager pipeline → `src/wallet/index.js`. Our sim engine is a *custom chain module* built on `@tetherto/wdk-wallet`'s `WalletManager`/`IWalletAccount` base classes (`src/wallet/sim-wallet.js`) — exactly the extension point WDK advertises — and `@tetherto/wdk-wallet-solana` drops in for devnet with the same call sites.
7. **Transaction Policies** — `wdk.registerPolicy({ scope: 'project', wallet, rules })`, **default-deny on governed accounts**, `PolicyViolationError`, `account.simulate.transfer(...)` → `src/wallet/index.js`, `src/agent/seat.js`, `test/wallet.test.js`. This is the whole "bounded autonomy" story: the agent pre-flights its own allowance, declines pots above its cap, and cannot even `sign()` outside its ALLOW rule. Without it: home-made limits the judges would have to trust.
8. **`account.transfer({ token, recipient, amount })` / `getAddress` / `getBalance`** — stake bonding and every settlement leg with per-transfer receipts → `src/wallet/index.js` (`stakeBond`, `executeSettlementLegs`). Without it: raw chain SDKs per network, one custody bug away from disaster.
9. **BIP-39 utilities** — `WDK.getRandomSeedPhrase()` for fresh self-custodial identities per participant → `src/wallet/index.js`. Without it: key-management code nobody should improvise.

## QVAC (the mind)

10. **`completion({ modelId, history, stream, tools })` with tool-calling** — the pundit must commit via the `submit_pick` tool (`type:'function'`, JSON-schema params) and we consume `run.events` (`contentDelta`, `toolCall`) → `src/agent/brains/qvac.js`. The pick is a *decision*, not parsed prose. Without it: brittle regex over free text, or a cloud API that breaks the entire premise.
11. **`loadModel({ modelSrc })` / `unloadModel`** — Qwen3 1.7B on-device (default chosen for empirically-verified tool-calling; Llama 1B-class models tended to narrate instead of calling); `TREBLE_QVAC_MODEL` accepts a local GGUF or a pear:// link → `src/agent/brains/qvac.js`. `npm run verify:offline` proves the reasoning path needs zero network. Without it: "AI opponent" = someone else's datacenter.

**Take any one stack out and The Treble is impossible:** without Pear you need a server (no longer trustless); without WDK the "AI with its own wallet" is a custodian in a trench coat; without QVAC the opponent is a cloud API (neither private nor yours, and against the QVAC track rule).

## Honest limitations of the sponsor stacks (as encountered)

- **`@tetherto/wdk` is beta** — pinned to `1.0.0-beta.12`. A policy DENY that merely *fails to match* an ALLOW reports `governed-but-unmatched` without policy metadata; we add an explicit DENY rule so blocked stakes carry `policyId`/`ruleName`. Chain modules (e.g. Solana) install separately; devnet funding is on the operator.
- **`@qvac/sdk` model weight** — the default LLM is a multi-hundred-MB first-run download with platform-specific native backends, so CI and the 20-second demo use a *disclosed* deterministic fallback brain; the SDK surface itself (tool schema, event stream) is exercised in tests without loading weights. On Bare, plugins must be registered explicitly (`@qvac/bare-sdk`) — our desktop UI keeps the LLM brain on the Node path for now.
- **Autobase concurrency semantics** are powerful but subtle: causally concurrent ops linearize deterministically yet not always intuitively (see AUDIT_REPORT "pick/lock window"), and replication acks need both peers to `update()`. The reducer is designed so every such ordering stays safe.

Full threat model and residual risk: [docs/AUDIT_REPORT.md](docs/AUDIT_REPORT.md).
