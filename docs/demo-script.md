# Galvanic Demo Script

**Target length:** 5 minutes
**Demo arc:** healthy account → hold → controlled crypto crash → liquidate crypto only → protected note survives

## The one-sentence product

> Galvanic lets a regulated real-world asset support borrowing without allowing a crypto liquidation to seize it.

## The human explanation

Imagine a lender accepts two assets from the same customer: crypto and a regulated bond.

Both assets can support borrowing, but they do not have the same rules. If the crypto price collapses, a normal pooled margin system may sell whatever collateral is available—including the regulated bond.

That model works for interchangeable crypto tokens. It does not work well for a KYC-controlled security token that cannot simply be transferred to any liquidator.

Galvanic creates a protected boundary around that asset.

The four technologies have simple roles:

- **Hedera** holds the actual regulated security token.
- **The Graph** shows what the account owes across other lending markets and how stressed those markets are.
- **Chainlink CRE** privately evaluates the risk rules.
- **Sepolia contracts** enforce which collateral can actually be touched.

The closing line:

> Galvanic does not stop liquidations. It stops the wrong asset from being liquidated.

## Accuracy rules

- The CRE simulator is not a real TEE. Say that it is a local simulation of the confidential handler, configured for AWS Nitro when deployed.
- Do not say the Hedera bond was sold or transferred. In pooled mode, the Sepolia-side margin claim is seized; the Hedera token itself does not move.
- Do not say the whole market crashed. The demo creates a controlled on-chain stress event by changing the demo mark.
- The current staging flow relays the CRE-produced report through the operator key. It is not yet official DON Forwarder delivery.
- Do not show the full `reportPayload` on camera. It is not useful to judges.

## Pre-recording setup

Use five terminals.

### Terminal 1 — The Graph service

```bash
cd /home/maues/mrgix/subgraph
bun run start
```

Leave it running. Confirm that it reports live mode.

### Terminal 2 — Position bridge

```bash
cd /home/maues/mrgix/cre-workflow/firewall-margin-workflow/firewall-margin
bun run bridge
```

Leave this running. Do not use this terminal for the CRE command.

### Terminal 3 — Reset the demo account

```bash
cd /home/maues/mrgix/contracts-sepolia
npm run demo:setup
```

Wait until the script prints the demo account’s crypto value, protected note value, debt and health factor.

### Terminal 4 — Start the application

```bash
cd /home/maues/mrgix/app
npm run dev
```

Open:

```text
http://localhost:3000
```

### Terminal 5 — Optional CRE view

Use this terminal only when showing the workflow itself:

```bash
cd /home/maues/mrgix/cre-workflow/firewall-margin-workflow

cre workflow simulate firewall-margin \
  --target staging-settings \
  --non-interactive \
  --trigger-index 0
```

## Recording script

### 0:00–0:35 — Start with the problem

**Screen:** Open `http://localhost:3000`. Show the landing-page hero and infrastructure section.

**Say:**

> This is Galvanic.
>
> It is built for a specific problem: using regulated real-world assets as collateral without exposing them to unrelated crypto liquidations.
>
> In a normal pooled margin account, crypto and other collateral sit in one recovery pool. If the crypto falls, the liquidation engine may reach for whichever asset can repay the debt.
>
> That works for interchangeable crypto tokens. It does not work well for a KYC-controlled security token that cannot simply be transferred to any liquidator.
>
> Galvanic creates a protected boundary around that asset.

**Action:** Click **Open the app →**.

### 0:35–1:05 — Show the real account

**Screen:** `/dashboard`.

**Actions:**

1. Click **Firewall**.
2. Click **Restore live mark**.
3. Wait for the transaction to complete.

**Say:**

> This is a live cross-margin account on Sepolia.
>
> It has crypto collateral, a debt position and a Hedera security token held by the same account.
>
> The crypto value is calculated by the vault. The protected note value comes from an attested Hedera balance. Nothing here is typed into the interface.
>
> The note is not bridged or wrapped. Hedera remains the record of ownership. Sepolia only records the value recognised for borrowing.

Point at **Portfolio health** and **Crypto-only health**:

> The important detail is the difference between portfolio health and crypto-only health.
>
> The crypto position alone is weaker than the total account. The protected note is genuinely contributing borrowing power.

### 1:05–1:30 — Explain the product in one card

**Screen:** Scroll to **Where the loss lands**.

**Say:**

> This is the product in one card.
>
> Both columns use the same debt, the same account and the same liquidation calculation. The only difference is the account’s margin mode.
>
> In pooled margin, if the crypto bucket runs out, the remaining shortfall becomes a claim against the protected note.
>
> In Firewall mode, the shortfall stops at the crypto bucket. The note’s borrowing recognition can be withdrawn, but the protected claim cannot be seized.

Point at **From the Hedera note**:

> These values are calculated by the vault’s `previewLiquidation` function before anything is executed.

### 1:30–1:50 — Show the healthy decision

**Screen:** Controls card.

**Action:** Click **Run confidential policy** and wait for the verdict.

**Expected result:** `Hold`.

**Say:**

> Before creating any stress, I am running the policy against the healthy account.
>
> The result is hold. The policy sees the account, the market data and the external exposure context, but there is no reason to liquidate yet.

The healthy baseline from the current run is:

```text
action: hold
amountUsd: 0
requiredHF: 1.151
marketStress: 11bps
```

If showing Terminal 5, show only the line beginning:

```text
[USER LOG] Galvanic verdict: hold
```

### 1:50–2:10 — Create the controlled stress event

**Screen:** Controls card.

**Action:** Click **Crash the crypto mark** and wait for the on-chain confirmation.

**Say:**

> Now I am creating one controlled stress event.
>
> This button writes a deliberate price collapse to the demo vault. It is the only manufactured input in the demonstration.
>
> The purpose is to show what happens when the volatile side of the account fails. The reaction after this is produced by the contracts and the confidential workflow.

Use the phrase **controlled on-chain stress event**. Do not say that the entire real market crashed.

### 2:10–2:45 — Run the confidential workflow

**Screen:** Switch to Terminal 5.

**Action:** Run:

```bash
cre workflow simulate firewall-margin \
  --target staging-settings \
  --non-interactive \
  --trigger-index 0
```

Show only:

```text
✓ Workflow compiled
Trigger requested TEE Execution
[USER LOG] Galvanic verdict: ...
Workflow Simulation Result
```

**Say:**

> This is the Chainlink CRE workflow evaluating the stressed account.
>
> In a deployed environment, this handler is configured to run in an AWS Nitro confidential environment. For this hackathon demonstration, I am using the local CRE simulator so we can inspect the workflow result and report bytes.
>
> The private policy thresholds are loaded inside the workflow. The raw thresholds do not come back to this interface.
>
> The workflow reads the position, the Hedera balance and standardized lending-market data, then returns one decision.

Do not describe the local simulator as proof of a live TEE.

**Screen:** Return to the browser and click **Run confidential policy**.

**Say:**

> The same decision is now visible in the product.
>
> The important result is not merely “liquidate”. The policy produces an action and an amount, while the vault still controls which collateral is legally reachable.

**Expected result:** `Liquidate the crypto leg`.

If the result is still `Hold`, stop and reset the demo. Do not continue with a false narration.

### 2:45–3:15 — Apply the decision on Sepolia

**Screen:** Verdict card.

**Actions:**

1. Click **Settle on Sepolia**.
2. Wait for confirmation.
3. Click **View the settling transaction on Etherscan →**.
4. Show the transaction briefly, then return to the dashboard.

**Say:**

> I am now applying the exact report produced by the workflow through the Sepolia executor.
>
> This is a real Sepolia state transition. The vault reduces the debt and transfers only the permitted crypto collateral.
>
> The protected note is not available as a fallback asset under Firewall mode.

If asked about DON delivery:

> The current staging flow relays the CRE-produced report through the operator key because official CRE Forwarder delivery is not enabled yet. The report format and executor logic are the same path intended for DON delivery.

### 3:15–3:40 — Show that the note survived

**Screen:** Scroll to **The note**.

Point at:

- **Units held**
- **Claim holder**
- Protected asset status

**Say:**

> This is the result.
>
> The crypto side was acted on. The Hedera units are still held by the account. The claim holder is still the account. The asset did not move.
>
> The firewall withdrew the note’s borrowing recognition and restricted new borrowing instead of allowing the crypto liquidation to seize the protected claim.

Use this exact sentence:

> The note was not sold. Its borrowing power was withdrawn.

### 3:40–4:05 — Show the pooled counterexample

**Screen:** Open:

```text
http://localhost:3000/#proof
```

Scroll to **Proof, not promises** and show both cards.

**Say:**

> This is the paired proof run.
>
> It used the same account, the same debt, the same crash and the same confidential decision.
>
> With Firewall off, the crypto collateral ran out and the Sepolia-side protected claim was seized for the remaining shortfall.
>
> With Firewall on, zero value was taken from the protected claim.
>
> To be precise, the pooled case records a claim seizure on Sepolia. It does not physically transfer the Hedera token. The actual token remains governed by Hedera’s compliance rules.

### 4:05–4:30 — Show the Hedera asset

**Screen:** Click **Protected assets**.

Show:

- Coupon rate
- Holder balance
- KYC evidence
- Lifecycle transactions

Open one HashScan transaction briefly.

**Say:**

> The protected asset is a real Hedera ATS security token.
>
> It has an approved-holder process, KYC controls, compliant transfers and a scheduled coupon.
>
> We also exercised the compliance system. When KYC was revoked, the token contract rejected the transfer.
>
> That is why this asset needs a protection boundary. It cannot be treated as an ordinary freely transferable crypto token.

### 4:30–4:50 — Explain The Graph simply

**Screen:** Click **Network data**.

**Action:** Click **$12M GHO borrower** and wait for the values.

**Say:**

> The Graph supplies the outside-world context.
>
> The same standardized query is sent across Aave, Compound and Spark.
>
> It answers three simple questions: how much does this account owe elsewhere, how stressed are the lending markets, and what is the current collateral price?
>
> The dashboard makes those signals visible. The confidential workflow independently reads the same type of information when it evaluates the policy.

### 4:50–5:00 — Close

**Screen:** Return to `/dashboard` and show the verdict and protected-note card.

**Say:**

> Galvanic separates the decision from the asset boundary.
>
> Chainlink CRE privately decides whether action is needed.
>
> The Sepolia vault decides what collateral can pay.
>
> Hedera remains the protected asset’s source of truth. The Graph provides the wider risk picture.
>
> And the firewall ensures that a crypto default does not become a forced sale of regulated collateral.
>
> Galvanic does not stop liquidations. It stops the wrong asset from being liquidated.

## The correct run order

Keep the current `hold` result as the healthy baseline. The recording sequence is:

```text
Open dashboard
→ Run confidential policy
→ Show Hold
→ Crash the crypto mark
→ Run the same policy again
→ Show Liquidate the crypto leg
→ Settle on Sepolia
→ Show the note still intact
```

This demonstrates that the system responds to a state change rather than presenting a pre-scripted liquidation.
