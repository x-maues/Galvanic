// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ReceiverTemplate} from "./cre/ReceiverTemplate.sol";
import {CryptoMarginVault} from "./CryptoMarginVault.sol";
import {ProtectedCollateralRegistry} from "./ProtectedCollateralRegistry.sol";

/// @title FirewallMarginExecutor
/// @notice The onchain landing point for the CRE Confidential Workflow's report.
///
/// The report carries two things the enclave produced:
///   1. the Hedera ATS attestation — units and marked value read from the Hedera mirror
///      node inside the TEE — which is what gives the protected asset borrowing power
///      on this chain without any bridge;
///   2. the policy action chosen from private thresholds that never left the enclave.
///
/// This contract is the vault's registered executor and the registry's registered
/// attestor. Nothing else can write an attestation or trigger a liquidation.
contract FirewallMarginExecutor is ReceiverTemplate {
    CryptoMarginVault public immutable vault;
    ProtectedCollateralRegistry public immutable registry;

    event VerdictReceived(address indexed account, uint8 action, uint256 amountUsd);
    event AttestationApplied(
        address indexed account, address indexed hederaToken, uint256 units, uint256 valueUsd
    );

    constructor(address forwarder, CryptoMarginVault _vault, ProtectedCollateralRegistry _registry)
        ReceiverTemplate(forwarder)
    {
        vault = _vault;
        registry = _registry;
    }

    /// @param report ABI-encoded
    /// (uint8 action, address account, uint256 amountUsd,
    ///  uint256 protectedUnits, uint256 protectedValueUsd, address hederaToken)
    /// exactly as `workflow.ts` encodes it.
    function _processReport(bytes calldata report) internal override {
        (
            uint8 action,
            address account,
            uint256 amountUsd,
            uint256 protectedUnits,
            uint256 protectedValueUsd,
            address hederaToken
        ) = abi.decode(report, (uint8, address, uint256, uint256, uint256, address));

        // The enclave-read Hedera holding becomes recognised margin here. Written on
        // every report so the recognition is only ever as fresh as the last attestation.
        if (hederaToken != address(0)) {
            registry.attest(account, hederaToken, protectedUnits, protectedValueUsd);
            emit AttestationApplied(account, hederaToken, protectedUnits, protectedValueUsd);
            // The enclave still sees the units with the account, so whatever a prior
            // event did to the note's *recognition*, the note itself is intact and
            // can back the account again.
            if (protectedUnits > 0 && action != 2) vault.restoreProtectedRecognition(account);
        }

        emit VerdictReceived(account, action, amountUsd);

        if (action == 0) {
            vault.setBorrowingRestriction(account, false);
        } else if (action == 1) {
            vault.setBorrowingRestriction(account, true);
        } else if (action == 2) {
            // amountUsd is a whole-dollar figure from the workflow; the debt asset is an
            // 18-decimal ERC20 pegged 1:1 to that unit for this demo.
            vault.executeLiquidation(account, amountUsd * 1e18);
        }
    }
}
