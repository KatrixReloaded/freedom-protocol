// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {IOptionFactory} from "../interfaces/IOptionFactory.sol";
import {OptionToken} from "../confidential/OptionToken.sol";
import {PublicOptionToken} from "../public/PublicOptionToken.sol";

contract UnshieldBridge {
    IOptionFactory public immutable confidentialFactory;
    IOptionFactory public immutable publicFactory;

    event Unshielded(address indexed user, uint256 indexed strike, uint64 maturity, bool isStable, uint256 amount);

    error SeriesNotFound();

    constructor(address confFactory_, address pubFactory_) {
        confidentialFactory = IOptionFactory(confFactory_);
        publicFactory       = IOptionFactory(pubFactory_);
    }

    /// @notice Burns `amount` confidential tokens, mints equal public tokens.
    ///         Amount is plaintext — user deliberately reveals their position size.
    function unshield(uint256 strike, uint64 maturity, bool isStable, uint256 amount) external {
        (address confStable, address confUp) = confidentialFactory.getTokens(strike, maturity);
        (address pubStable,  address pubUp)  = publicFactory.getTokens(strike, maturity);
        if (confStable == address(0) || pubStable == address(0)) revert SeriesNotFound();

        OptionToken       confToken = OptionToken(isStable       ? confStable : confUp);
        PublicOptionToken pubToken  = PublicOptionToken(isStable ? pubStable  : pubUp);

        euint64 encAmount = FHE.asEuint64(uint64(amount));
        FHE.allow(encAmount, address(confToken));
        confToken.burn(msg.sender, encAmount);

        pubToken.mint(msg.sender, amount);

        emit Unshielded(msg.sender, strike, maturity, isStable, amount);
    }
}
