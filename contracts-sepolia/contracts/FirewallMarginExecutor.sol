// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./cre/ReceiverTemplate.sol";
import {CryptoMarginVault} from "./CryptoMarginVault.sol";

/// @title FirewallMarginExecutor
/// @notice The onchain landing point for the CRE Confidential Workflow's verdict.
/// Receives a DON-signed report via the CRE Forwarder (through ReceiverTemplate),
/// decodes `{liquidate, account, amountUsd}`, and — only if the TEE decided to
/// liquidate — calls the vault's gated `executeLiquidation`. This contract is the
/// vault's registered `creExecutor`; nothing else can trigger a liquidation.
contract FirewallMarginExecutor is ReceiverTemplate {
    CryptoMarginVault public immutable vault;

    event VerdictReceived(address indexed account, uint256 amountUsd, bool liquidate);

    constructor(address forwarder, CryptoMarginVault _vault) ReceiverTemplate(forwarder) {
        vault = _vault;
    }

    /// @param report ABI-encoded (bool liquidate, address account, uint256 amountUsd),
    /// exactly as `workflow.ts` encodes it with
    /// `encodeAbiParameters(parseAbiParameters('bool liquidate, address account, uint256 amountUsd'), ...)`.
    function _processReport(bytes calldata report) internal override {
        (bool liquidate, address account, uint256 amountUsd) = abi.decode(report, (bool, address, uint256));
        emit VerdictReceived(account, amountUsd, liquidate);

        if (liquidate) {
            // amountUsd is a whole-dollar figure from the workflow; the debt asset is an
            // 18-decimal ERC20 pegged 1:1 to that unit for this demo.
            vault.executeLiquidation(account, amountUsd * 1e18);
        }
    }
}
