// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MockTokens.sol";
import "./ProtectedCollateralRegistry.sol";

/// @title CryptoMarginVault
/// @notice A cross-margin account: borrowing power comes from BOTH the volatile crypto
/// collateral held here and the attested Hedera ATS security token recognised in the
/// ProtectedCollateralRegistry. That is the "cross-margin" half of the product — without
/// it there would be nothing to firewall.
///
/// The firewall is the other half. Every account carries a margin mode:
///
///   Firewall (default) — a crypto-side default may only draw on the crypto bucket.
///     When the seizure exceeds the crypto bucket, the protected asset's *recognition*
///     is revoked (borrowing power falls, new borrowing is restricted) but its claim is
///     never touched. The protocol absorbs the shortfall rather than reaching across.
///
///   Pooled — conventional cross-margin. The same default drains the crypto bucket and
///     then seizes the margin claim on the protected asset. This mode exists so the demo
///     can show the contamination it is preventing, on the same contract, same account,
///     same price move.
///
/// `price` is a demo-only stand-in for a market feed, settable by the demo operator so
/// stress can be produced deterministically on cue. Everything else is real logic.
contract CryptoMarginVault is Ownable {
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;

    enum MarginMode {
        Firewall,
        Pooled
    }

    /// @dev collateral value required per unit of debt to stay healthy.
    uint256 public liquidationThresholdBps = 8_000; // 80%
    /// @dev bonus paid to the liquidation caller, seized from the account's collateral.
    uint256 public liquidationBonusBps = 500; // 5%
    /// @dev haircut applied to the attested RWA value before it counts as margin.
    uint256 public rwaHaircutBps = 9_500; // 5% haircut on a short-term note

    /// @dev price of 1 whole collateral token, in whole debt-asset units, scaled by WAD.
    uint256 public price;

    address public demoOperator;
    /// @dev only address allowed to apply a CRE verdict — the workflow's onchain executor.
    address public creExecutor;

    ProtectedCollateralRegistry public registry;

    mapping(address => MarginMode) public marginMode;
    /// @dev Accounts above the confidential exposure limit, or whose protected
    /// recognition was revoked by a firewall event, cannot open new debt.
    mapping(address => bool) public borrowingRestricted;
    /// @dev Set when a firewall event withdraws the protected asset's borrowing power.
    /// The asset itself is untouched; only its margin recognition stops.
    mapping(address => bool) public protectedRecognitionRevoked;

    MockCollateral public immutable collateralToken;
    MockDebt public immutable debtToken;

    struct Position {
        uint256 collateral;
        uint256 debt;
    }

    mapping(address => Position) public positions;

    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event Borrowed(address indexed account, uint256 amount);
    event Repaid(address indexed account, uint256 amount);
    event PriceUpdated(uint256 newPrice);
    event Liquidated(address indexed account, uint256 debtRepaid, uint256 collateralSeized);
    event ExecutorUpdated(address indexed executor);
    event RegistryUpdated(address indexed registry);
    event MarginModeUpdated(address indexed account, MarginMode mode);
    event BorrowingRestrictionUpdated(address indexed account, bool restricted);
    /// @notice Pooled margin reached across into the protected asset.
    event ProtectedCollateralSeized(address indexed account, uint256 valueUsd, uint256 shortfallUsd);
    /// @notice The firewall held: the shortfall stopped at the crypto bucket.
    event ProtectedCollateralPreserved(
        address indexed account, uint256 shortfallUsd, uint256 protectedValueUsd
    );

    error NotExecutor();
    error NotDemoOperator();
    error UnhealthyPosition();
    error PositionHealthy();
    error BorrowingRestricted();

    modifier onlyExecutor() {
        if (msg.sender != creExecutor) revert NotExecutor();
        _;
    }

    modifier onlyDemoOperator() {
        if (msg.sender != demoOperator) revert NotDemoOperator();
        _;
    }

    constructor(MockCollateral _collateral, MockDebt _debt, uint256 initialPrice)
        Ownable(msg.sender)
    {
        collateralToken = _collateral;
        debtToken = _debt;
        price = initialPrice;
        demoOperator = msg.sender;
    }

    // --- collateral valuation ---

    /// @notice USD value of the liquid crypto bucket. This is the only value a
    /// liquidation is ever allowed to draw on under the firewall.
    function cryptoValue(address account) public view returns (uint256) {
        return (positions[account].collateral * price) / WAD;
    }

    /// @notice Haircut USD value of the attested Hedera ATS holding, as recognised for
    /// margin. Zero if recognition was revoked by a firewall event or the claim was
    /// seized in pooled mode.
    function protectedValue(address account) public view returns (uint256) {
        if (address(registry) == address(0)) return 0;
        if (protectedRecognitionRevoked[account]) return 0;
        return (registry.marginValueOf(account) * rwaHaircutBps) / BPS;
    }

    /// @notice Total cross-margin collateral backing the account.
    function totalCollateralValue(address account) public view returns (uint256) {
        return cryptoValue(account) + protectedValue(account);
    }

    // --- account actions ---

    function deposit(uint256 amount) external {
        positions[msg.sender].collateral += amount;
        collateralToken.transferFrom(msg.sender, address(this), amount);
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external {
        Position storage pos = positions[msg.sender];
        pos.collateral -= amount;
        if (healthFactor(msg.sender) < WAD) revert UnhealthyPosition();
        collateralToken.transfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    /// @dev Vault bootstraps its own debt-asset liquidity via the demo token's public
    /// faucet — MockDebt is a demo-only asset with no real value.
    function borrow(uint256 amount) external {
        if (borrowingRestricted[msg.sender]) revert BorrowingRestricted();
        Position storage pos = positions[msg.sender];
        pos.debt += amount;
        if (healthFactor(msg.sender) < WAD) revert UnhealthyPosition();
        debtToken.faucet(amount);
        debtToken.transfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external {
        Position storage pos = positions[msg.sender];
        pos.debt -= amount;
        debtToken.transferFrom(msg.sender, address(this), amount);
        emit Repaid(msg.sender, amount);
    }

    /// @notice An account chooses how its own collateral may be treated.
    function setMarginMode(MarginMode mode) external {
        marginMode[msg.sender] = mode;
        emit MarginModeUpdated(msg.sender, mode);
    }

    // --- risk engine ---

    /// @notice WAD-scaled portfolio health factor across BOTH collateral classes.
    /// >= 1e18 is healthy. This is what borrowing power is checked against.
    function healthFactor(address account) public view returns (uint256) {
        return _healthFrom(totalCollateralValue(account), positions[account].debt);
    }

    /// @notice WAD-scaled health of the crypto bucket alone. Under the firewall this is
    /// the only number that can authorise a seizure, because it is the only collateral
    /// the seizure is permitted to reach.
    function cryptoHealthFactor(address account) public view returns (uint256) {
        return _healthFrom(cryptoValue(account), positions[account].debt);
    }

    function _healthFrom(uint256 collateralValue, uint256 debt) private view returns (uint256) {
        if (debt == 0) return type(uint256).max;
        uint256 adjusted = (collateralValue * liquidationThresholdBps) / BPS;
        return (adjusted * WAD) / debt;
    }

    /// @notice Demo-only stress trigger, stands in for a live price feed.
    function setPrice(uint256 newPrice) external onlyDemoOperator {
        price = newPrice;
        emit PriceUpdated(newPrice);
    }

    /// @notice What a liquidation of `debtToCover` would do to each collateral class,
    /// under each margin mode, without executing anything. The UI uses this to put the
    /// pooled outcome and the firewall outcome side by side before acting.
    /// @return cryptoSeizedUsd value drawn from the crypto bucket (identical in both modes)
    /// @return shortfallUsd value the crypto bucket could not cover
    /// @return protectedSeizedUsdPooled protected value a POOLED liquidation would take
    /// @return protectedSeizedUsdFirewall protected value a FIREWALL liquidation would take (always 0)
    function previewLiquidation(address account, uint256 debtToCover)
        external
        view
        returns (
            uint256 cryptoSeizedUsd,
            uint256 shortfallUsd,
            uint256 protectedSeizedUsdPooled,
            uint256 protectedSeizedUsdFirewall
        )
    {
        Position storage pos = positions[account];
        uint256 cover = debtToCover > pos.debt ? pos.debt : debtToCover;
        uint256 target = (cover * (BPS + liquidationBonusBps)) / BPS;
        uint256 available = cryptoValue(account);

        cryptoSeizedUsd = target <= available ? target : available;
        shortfallUsd = target - cryptoSeizedUsd;

        uint256 protectedAvailable = protectedValue(account);
        protectedSeizedUsdPooled =
            shortfallUsd == 0 ? 0 : (shortfallUsd <= protectedAvailable ? shortfallUsd : protectedAvailable);
        protectedSeizedUsdFirewall = 0;
    }

    /// @notice Applies the CRE confidential policy's liquidation verdict.
    ///
    /// Draws first on the crypto bucket. If that is not enough, the account's margin
    /// mode — not the liquidator, not this function's caller — decides what happens to
    /// the protected asset:
    ///   Pooled   -> the margin claim over the Hedera note is seized. Contamination.
    ///   Firewall -> the claim is untouched; recognition is revoked and borrowing is
    ///               restricted instead, and the protocol carries the shortfall.
    function executeLiquidation(address account, uint256 debtToCover) external onlyExecutor {
        if (healthFactor(account) >= WAD) revert PositionHealthy();
        Position storage pos = positions[account];

        uint256 cover = debtToCover > pos.debt ? pos.debt : debtToCover;
        uint256 target = (cover * (BPS + liquidationBonusBps)) / BPS;
        uint256 available = cryptoValue(account);

        uint256 fromCrypto = target <= available ? target : available;
        uint256 shortfall = target - fromCrypto;

        uint256 seizeTokens = (fromCrypto * WAD) / price;
        if (seizeTokens > pos.collateral) seizeTokens = pos.collateral;

        pos.debt -= cover;
        pos.collateral -= seizeTokens;
        collateralToken.transfer(creExecutor, seizeTokens);
        emit Liquidated(account, cover, seizeTokens);

        if (shortfall == 0) return;

        if (marginMode[account] == MarginMode.Pooled && address(registry) != address(0)) {
            uint256 seizedUsd = registry.seizeClaim(account, creExecutor);
            emit ProtectedCollateralSeized(account, seizedUsd, shortfall);
        } else {
            protectedRecognitionRevoked[account] = true;
            borrowingRestricted[account] = true;
            emit BorrowingRestrictionUpdated(account, true);
            emit ProtectedCollateralPreserved(
                account, shortfall, address(registry) == address(0) ? 0 : registry.marginValueOf(account)
            );
        }
    }

    /// @notice Restores the protected asset's borrowing power after a firewall event,
    /// once the policy is satisfied again. Only the executor may call it, and it can
    /// never move collateral — it only turns recognition back on.
    function restoreProtectedRecognition(address account) external onlyExecutor {
        protectedRecognitionRevoked[account] = false;
    }

    /// @notice Persists a confidential policy decision without seizing collateral.
    function setBorrowingRestriction(address account, bool restricted) external onlyExecutor {
        borrowingRestricted[account] = restricted;
        if (!restricted) protectedRecognitionRevoked[account] = false;
        emit BorrowingRestrictionUpdated(account, restricted);
    }

    // --- admin ---

    function setExecutor(address executor) external onlyOwner {
        creExecutor = executor;
        emit ExecutorUpdated(executor);
    }

    function setRegistry(ProtectedCollateralRegistry newRegistry) external onlyOwner {
        registry = newRegistry;
        emit RegistryUpdated(address(newRegistry));
    }

    function setDemoOperator(address operator) external onlyOwner {
        demoOperator = operator;
    }

    /// @dev Demo-only: lets the operator set the mode for the account being recorded.
    function setMarginModeFor(address account, MarginMode mode) external onlyDemoOperator {
        marginMode[account] = mode;
        emit MarginModeUpdated(account, mode);
    }
}
