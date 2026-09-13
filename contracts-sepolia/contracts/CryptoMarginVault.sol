// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./MockTokens.sol";

/// @title CryptoMarginVault
/// @notice The liquid, liquidatable leg of a Firewall Margin account. Holds only the
/// volatile crypto collateral and its associated debt — it has no knowledge of, and no
/// custody path into, the protected RWA leg on Hedera. Liquidation here can never reach
/// that leg: they are different contracts on different chains.
///
/// The `price` is a demo-only stand-in for a real market feed, settable by the demo
/// operator so the recorded demo can trigger stress deterministically on cue. Everything
/// else (accounting, health factor, liquidation gating) is real, auditable logic.
contract CryptoMarginVault is Ownable {
    uint256 private constant WAD = 1e18;
    uint256 private constant BPS = 10_000;

    /// @dev collateral value (in debt-asset units) required per unit of debt to stay healthy.
    uint256 public liquidationThresholdBps = 8_000; // 80%
    /// @dev bonus paid to the liquidation caller, seized from the account's collateral.
    uint256 public liquidationBonusBps = 500; // 5%

    /// @dev price of 1 whole collateral token, in whole debt-asset units, scaled by WAD.
    uint256 public price;

    address public demoOperator;
    /// @dev only address allowed to call executeLiquidation — the CRE workflow's onchain identity.
    address public creExecutor;

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

    error NotExecutor();
    error NotDemoOperator();
    error UnhealthyPosition();
    error PositionHealthy();
    error InsufficientDebt();

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
    /// faucet — MockDebt is a demo-only asset with no real value, this is not a real
    /// money-market borrow settlement.
    function borrow(uint256 amount) external {
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

    // --- risk engine ---

    /// @notice WAD-scaled health factor. >= 1e18 is healthy, below is liquidatable.
    function healthFactor(address account) public view returns (uint256) {
        Position storage pos = positions[account];
        if (pos.debt == 0) return type(uint256).max;
        uint256 collateralValue = (pos.collateral * price) / WAD;
        uint256 adjusted = (collateralValue * liquidationThresholdBps) / BPS;
        return (adjusted * WAD) / pos.debt;
    }

    /// @notice Demo-only stress trigger, stands in for a live price feed so the crypto
    /// leg's stress condition can be produced deterministically on cue during the demo.
    function setPrice(uint256 newPrice) external onlyDemoOperator {
        price = newPrice;
        emit PriceUpdated(newPrice);
    }

    /// @notice Called only by the CRE confidential workflow's onchain executor address,
    /// after its TEE-computed verdict decides the crypto leg should be liquidated. This
    /// function has no path to any other contract, chain, or the RWA leg.
    function executeLiquidation(address account, uint256 debtToCover)
        external
        onlyExecutor
    {
        if (healthFactor(account) >= WAD) revert PositionHealthy();
        Position storage pos = positions[account];
        if (debtToCover > pos.debt) revert InsufficientDebt();

        uint256 collateralValue = (debtToCover * WAD) / price;
        uint256 seize = (collateralValue * (BPS + liquidationBonusBps)) / BPS;
        if (seize > pos.collateral) seize = pos.collateral;

        pos.debt -= debtToCover;
        pos.collateral -= seize;

        collateralToken.transfer(creExecutor, seize);
        emit Liquidated(account, debtToCover, seize);
    }

    // --- admin ---

    function setExecutor(address executor) external onlyOwner {
        creExecutor = executor;
        emit ExecutorUpdated(executor);
    }

    function setDemoOperator(address operator) external onlyOwner {
        demoOperator = operator;
    }
}
