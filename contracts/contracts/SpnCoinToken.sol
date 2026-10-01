// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ─────────────────────────────────────────────────────────────
 *  SPN Coin (SPN) — ERC-20 token
 *  Path A: token on an existing, battle-tested chain (Ethereum / L2)
 *
 *  Security design choices (deliberate):
 *   - Built ENTIRELY on audited OpenZeppelin v5 contracts. No custom
 *     crypto, no custom math (Solidity 0.8 has built-in overflow checks).
 *   - FIXED SUPPLY: the full supply is minted once, in the constructor,
 *     to the recipient. There is NO mint() function afterwards, so the
 *     supply can never be inflated. This removes the single most common
 *     "rug pull" vector and is the safest model for a launch token.
 *   - NO owner, NO blacklist, NO transfer tax, NO pausable. Every extra
 *     privileged function is attack surface and a red flag to auditors,
 *     exchanges, and users. Keep the token boring.
 *   - ERC20Permit (EIP-2612) for gasless approvals.
 *   - ERC20Burnable so holders can voluntarily burn their own tokens.
 *
 *  If you later need controlled minting (e.g. staking rewards), do NOT
 *  edit this file — deploy a SEPARATE, capped, multisig-owned minter
 *  contract and have it audited. See docs/PATH_A_ROADMAP.md.
 * ─────────────────────────────────────────────────────────────
 */

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

contract SpnCoinToken is ERC20, ERC20Burnable, ERC20Permit {
    /// @notice Total fixed supply: 21,000,000 SPN (18 decimals, ERC-20 standard).
    uint256 public constant MAX_SUPPLY = 21_000_000 * 1e18;

    /**
     * @param recipient Address that receives the entire initial supply.
     *                  Use a multisig (e.g. Gnosis Safe) — never a fresh EOA.
     */
    constructor(address recipient)
        ERC20("SPN Coin", "SPN")
        ERC20Permit("SPN Coin")
    {
        require(recipient != address(0), "recipient is zero address");
        _mint(recipient, MAX_SUPPLY);
    }
}
