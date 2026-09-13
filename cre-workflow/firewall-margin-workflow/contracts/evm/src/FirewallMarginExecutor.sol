// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ReceiverTemplate} from "./ReceiverTemplate.sol";

/**
 * @title FirewallMarginExecutor
 * @notice Generic, pluggable onchain receiver for the Firewall Margin confidential
 *         liquidation verdict.
 *
 *         The CRE Confidential Workflow (firewall-margin-workflow/firewall-margin)
 *         computes `{liquidate, account, amountUsd}` inside a TEE from private
 *         policy thresholds + live crypto collateral health/LTV + cross-protocol
 *         exposure, then delivers it here as a DON-signed report via the CRE
 *         Forwarder.
 *
 *         NOT DEPLOYED / NOT COMPILED in this pass — no Foundry project or
 *         OpenZeppelin dependency is wired up yet, this is reference wiring for
 *         when the real Firewall Margin vault exists. Swap `_processReport`'s
 *         body for a real call into that vault, e.g.:
 *
 *             IFirewallVault(vault).executeLiquidation(account, amountUsd);
 *
 *         Until then this contract can stand in as its own minimal executor:
 *         it emits the same events a real vault call site would need to
 *         observe on Sepolia to prove the state transition happened.
 */
contract FirewallMarginExecutor is ReceiverTemplate {
    event LiquidationVerdictReceived(address indexed account, uint256 amountUsd, bool liquidate);
    event LiquidationExecuted(address indexed account, uint256 amountUsd);

    constructor(address forwarder) ReceiverTemplate(forwarder) {}

    /// @notice Called by the CRE Forwarder via ReceiverTemplate.onReport
    /// @param report ABI-encoded (bool liquidate, address account, uint256 amountUsd)
    ///        — the exact shape `workflow.ts` encodes with
    ///        `encodeAbiParameters(parseAbiParameters('bool liquidate, address account, uint256 amountUsd'), ...)`.
    function _processReport(bytes calldata report) internal override {
        (bool liquidate, address account, uint256 amountUsd) = abi.decode(report, (bool, address, uint256));
        emit LiquidationVerdictReceived(account, amountUsd, liquidate);

        if (liquidate) {
            executeLiquidation(account, amountUsd);
        }
    }

    /// @notice Placeholder liquidation entrypoint. A deployed Firewall Margin
    ///         vault would isolate and act on `account`'s crypto collateral
    ///         leg only, leaving protected RWA collateral untouched.
    function executeLiquidation(address account, uint256 amountUsd) public {
        emit LiquidationExecuted(account, amountUsd);
    }
}
