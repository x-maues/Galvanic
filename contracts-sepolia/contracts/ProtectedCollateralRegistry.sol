// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title ProtectedCollateralRegistry
/// @notice The Sepolia-side *recognition* of an account's Hedera ATS security-token
/// holding, so that the protected asset can grant real borrowing power on this chain.
///
/// What this contract is:
///   - a record of an attested Hedera balance (units + marked USD value), written only
///     by the CRE attestor after the value was read from the Hedera mirror node inside
///     the confidential enclave;
///   - the ledger of who holds the *margin claim* on that asset.
///
/// What this contract is deliberately NOT:
///   - a bridge. It holds no Hedera units, mints no wrapper, and cannot move anything
///     on Hedera. Seizing a claim here does not and cannot transfer the ATS token;
///     it records that a liquidator acquired a claim which would still have to pass the
///     ATS compliance module (KYC, transfer restrictions) to ever be settled.
///
/// That asymmetry is the entire point of the product: in pooled margin the claim is
/// seizable and the protected asset is contaminated by a crypto-side default; under the
/// firewall it is not reachable at all.
contract ProtectedCollateralRegistry {
    struct Attestation {
        uint256 units; // ATS units, in the bond's own decimals
        uint256 valueUsd; // WAD-scaled marked value of those units
        uint64 attestedAt; // block timestamp of the last enclave attestation
        address hederaToken; // EVM address of the ATS security token on Hedera
        bool claimSeized; // true once a pooled-margin liquidation took the claim
        address claimHolder; // who holds the margin claim (account, or liquidator after seizure)
    }

    address public owner;
    /// @dev The CRE workflow's onchain identity. Only it may write attested values.
    address public attestor;
    /// @dev The only contract allowed to seize a claim (the margin vault).
    address public vault;

    mapping(address => Attestation) private _attestations;

    event AttestorUpdated(address indexed attestor);
    event VaultUpdated(address indexed vault);
    event ProtectedAssetAttested(
        address indexed account, address indexed hederaToken, uint256 units, uint256 valueUsd
    );
    event ProtectedClaimSeized(
        address indexed account, address indexed beneficiary, uint256 valueUsd, uint256 units
    );

    error NotOwner();
    error NotAttestor();
    error NotVault();
    error AlreadySeized();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyAttestor() {
        if (msg.sender != attestor) revert NotAttestor();
        _;
    }

    modifier onlyVault() {
        if (msg.sender != vault) revert NotVault();
        _;
    }

    function setAttestor(address newAttestor) external onlyOwner {
        attestor = newAttestor;
        emit AttestorUpdated(newAttestor);
    }

    function setVault(address newVault) external onlyOwner {
        vault = newVault;
        emit VaultUpdated(newVault);
    }

    /// @notice Records the Hedera ATS holding read inside the CRE enclave.
    /// @dev A fresh attestation with a non-zero balance clears a prior seizure, and
    /// that is deliberate. A seizure here is a claim, not a settlement: it says a
    /// liquidator is owed the note, not that the note moved. If the enclave looks at
    /// Hedera again and sees the units still sitting with the account — because the
    /// ATS compliance module never permitted the transfer — then the claim was never
    /// made good, and this contract has no business continuing to assert it. Hedera
    /// is the record of ownership; this is only a recognition of it.
    function attest(address account, address hederaToken, uint256 units, uint256 valueUsd)
        external
        onlyAttestor
    {
        Attestation storage a = _attestations[account];
        a.units = units;
        a.valueUsd = valueUsd;
        a.attestedAt = uint64(block.timestamp);
        a.hederaToken = hederaToken;
        if (units > 0) {
            a.claimSeized = false;
            a.claimHolder = account;
        } else if (a.claimHolder == address(0)) {
            a.claimHolder = account;
        }
        emit ProtectedAssetAttested(account, hederaToken, units, valueUsd);
    }

    /// @notice Pooled-margin contamination path: a crypto-side default reaches the
    /// protected asset and the liquidator takes the margin claim over it.
    /// Callable only by the vault, and only ever in pooled mode.
    function seizeClaim(address account, address beneficiary) external onlyVault returns (uint256) {
        Attestation storage a = _attestations[account];
        if (a.claimSeized) revert AlreadySeized();
        a.claimSeized = true;
        a.claimHolder = beneficiary;
        uint256 value = a.valueUsd;
        emit ProtectedClaimSeized(account, beneficiary, value, a.units);
        return value;
    }

    /// @notice Marked USD value recognised for margin. Zero once the claim is seized —
    /// the account no longer owns the collateral it once had.
    function marginValueOf(address account) external view returns (uint256) {
        Attestation storage a = _attestations[account];
        return a.claimSeized ? 0 : a.valueUsd;
    }

    function attestationOf(address account) external view returns (Attestation memory) {
        return _attestations[account];
    }
}
