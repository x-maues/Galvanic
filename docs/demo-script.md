# Galvanic — 3½ minute demo

One claim, proved on camera: **a tokenized bond can grant real borrowing power in a
cross-margin account without becoming collateral damage when crypto crashes.**

Before recording, run `npm run demo:setup` in `contracts-sepolia/` so the account
starts healthy, and have all four services up (see README).

---

## 0:00 – 0:25 · The setup, and why it is not trivial

Open `/dashboard`. Point at the top row.

> This account holds two kinds of collateral. Twenty-seven thousand dollars of ETH,
> and thirty thousand dollars of a bond issued on Hedera through the Asset
> Tokenization Studio — KYC-gated, with a coupon. It has thirty-five thousand of debt
> against both.
>
> Look at the last two numbers. Portfolio health is 1.27 — fine. **Crypto-only health
> is 0.62.** The crypto leg alone could not support this loan. The bond is genuinely
> carrying this position, which means there is genuinely something here to lose.

That sentence is the whole reason the rest matters. Do not rush it.

## 0:25 – 1:00 · Where the loss would land

Scroll to *Where the loss lands*.

> Both of these columns are computed by the vault itself, right now, from the same
> close factor on the same debt. The only thing that differs is one flag on the
> account.

Click **Crash the crypto mark**. The mark drops 92%, on-chain, and the two columns
diverge.

> Pooled margin takes two thousand from crypto — and then sixteen thousand from the
> bond. That is normal cross-margin, and that is the failure mode: a bond that was
> never in trouble gets sold because ETH moved.
>
> The firewall takes the same two thousand and stops.

## 1:00 – 1:45 · The confidential decision

Click **Run confidential policy**.

> This is a Chainlink CRE workflow running under `handlerInTee` in an AWS Nitro
> enclave. Three things happen only inside it: the risk policy loads as a secret —
> publish those thresholds and you know exactly where to push this account; the
> Graph API key loads as a secret and is used from inside the enclave; and the
> Hedera mirror node is read directly for the bond balance.

Point at *Required health 1.151* and *Market stress 11 bps*.

> The private floor is 1.15. The extra is live market data — The Graph tells us how
> hard Aave, Compound and Spark are liquidating right now, and the required health
> factor moves with it. The liquidation line is not a constant.

Point at the Hedera attestation line.

> And this is how a Hedera asset backs a Sepolia position with no bridge. The enclave
> observes the balance; the DON signs for what it saw. Nothing is wrapped or locked.

## 1:45 – 2:25 · Settle it, for real

Click **Settle on Sepolia**, then open the Etherscan link.

> That is the enclave's own report bytes, applied on chain. The crypto leg was
> liquidated. Now look at the bond.

Scroll to the note card.

> Three thousand units. Claim holder: still the account. What the firewall did
> instead of seizing is withdraw the bond's borrowing power and restrict new
> borrowing — the account is not let off, and the protocol carries the shortfall.
> It just does not reach across a compliance boundary to make itself whole.

Switch to **Pooled margin**, crash, run, settle. Show *Claim holder: Liquidator*.

> Same contract. Same account. Same crash. Same report. One flag.

## 2:25 – 3:00 · The evidence

**Protected assets** page:

> The bond is real. Issued through the ATS Factory on Hedera testnet, KYC granted,
> transferred under compliance, a 2.5% coupon scheduled and its record date reached
> on chain — that is the holder's payable amount, read back from the snapshot the
> contract took. And we revoked KYC and confirmed a transfer reverts, so the
> compliance is exercised, not just configured.

**Network data** page — paste a real Aave borrower address.

> One query, written once against Messari's standardized Lending schema, sent
> unmodified to three protocols. Here it is against a live mainnet borrower with
> twelve million in debt. The exposure cap trips and the policy restricts borrowing
> instead of liquidating — because borrowing elsewhere is not a breach of *this*
> position's terms.

## 3:00 – 3:30 · The point

> Every tokenization pitch ends at issuance. The question nobody answers is what
> happens to that asset on the worst day of the market, when it is sitting in a
> margin account next to something volatile.
>
> Galvanic answers it, and shows you the counterfactual so you do not have to take
> our word for it. The policy sets how much debt to close. The vault decides which
> collateral may pay for it. Those two decisions live in different contracts, and
> that separation is the entire product.

---

## What to say if asked about the DON

> The confidential workflow runs and produces the report. Confidential Workflow
> deployment access is a Chainlink permission we do not have yet, so the executor
> accepts that report from our operator key rather than from the CRE Forwarder.
> `use-don-forwarder.ts` changes that with one owner call, and `_processReport` is
> identical either way. We are not going to let a screen imply a DON wrote it.

## Non-interactive backup

If anything is flaky live, `npm run demo:prove` runs both modes end to end on Sepolia
and writes `prove-firewall.json` with transaction hashes for each.
