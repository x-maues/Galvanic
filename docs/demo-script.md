# Demo script (2–4 min)

Prereqs: `.env` filled in, Hedera bond issued (`contracts-hedera/`), Sepolia vault +
executor deployed (`contracts-sepolia/`), `subgraph/server.ts` and/or
`cre-workflow/.../mock-server.js` running, frontend running (`app/`, `npm run dev`).

1. **Show the account.** Open the frontend. Point out the two panels: protected RWA leg
   (Hedera) and liquid crypto leg (Sepolia) — different contracts, different chains, no
   shared custody. Click through to HashScan for the bond contract.
2. **Show live Graph exposure data.** Point out the cross-protocol exposure figure feeding
   the confidential decision — a real Messari Standardized Lending/CDP subgraph query
   across multiple live protocols (see `subgraph/README.md` for which ones), not a single
   raw query.
3. **Show the healthy state.** Health factor panel is green/healthy on the crypto leg.
4. **Trigger controlled stress.** Click "Trigger stress" — a real onchain tx
   (`vault.setPrice`) crashes the mock collateral price. Health factor flips
   red/liquidatable, live.
5. **Run the confidential decision.** Click "Run confidential decision." This is a real
   `cre workflow simulate` invocation — inside the (simulated) TEE, private policy
   thresholds + live vault health + Graph exposure combine into one verdict. Only the
   verdict is shown; the private thresholds never left the enclave.
6. **Show the resulting state transition.** If deployed with `onchain.enabled: true`, the
   verdict is delivered via the CRE Forwarder to `FirewallMarginExecutor`, which calls
   `vault.executeLiquidation` — show the tx on Sepolia/Etherscan and the vault's updated
   position. (If still `onchain.enabled: false`, show the verdict + note the wiring is
   real but not yet flipped on — see `cre-workflow/README.md`.)
7. **Show the RWA leg untouched.** Refresh the Hedera panel — same balance, same KYC
   status, same contract, completely unaffected. This is the core claim: not "chose not
   to," but structurally couldn't.
8. **Show Hedera lifecycle evidence.** Point at the KYC grant + compliant transfer tx
   hashes from `contracts-hedera/issued-asset.json` — a real compliance-gated lifecycle
   operation, not a decorative flag.
9. **Close with the insight.** One risk engine, two collateral domains, one confidential
   decision — crypto absorbs stress, RWA never enters the blast radius.

## Evidence checklist for submission

- [ ] Hedera bond contract address + HashScan link + KYC/transfer tx hashes
      (`contracts-hedera/issued-asset.json`)
- [ ] Sepolia vault + executor addresses + Etherscan links
- [ ] CRE workflow simulation output (healthy + stressed verdicts) or live deployment logs
- [ ] Subgraph query evidence (which live deployments, what schema, what number fed the
      decision) — `subgraph/README.md`
- [ ] Screen recording of the frontend flow above
