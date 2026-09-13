// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Demo-only collateral asset (stand-in for a volatile crypto asset). Public
/// faucet so the recorded demo can be reproduced by anyone with a Sepolia key.
contract MockCollateral is ERC20 {
    constructor() ERC20("Firewall Margin Mock ETH", "fmETH") {}

    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}

/// @notice Demo-only debt asset (stand-in for a stablecoin borrow).
contract MockDebt is ERC20 {
    constructor() ERC20("Firewall Margin Mock USD", "fmUSD") {}

    function faucet(uint256 amount) external {
        _mint(msg.sender, amount);
    }
}
