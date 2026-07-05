// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, euint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";

interface IConfidentialCollateralToken {
    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64);
    function confidentialTransfer(address to, euint64 amount) external returns (euint64);
}

/// @notice Central encrypted cWETH custody for all confidential option series created by one factory.
contract ConfidentialCollateralVault {
    IConfidentialCollateralToken public immutable cWETH;
    address public immutable factory;

    mapping(bytes32 => euint64) internal _reserves;

    event ReserveDeposited(bytes32 indexed seriesId, address indexed from);
    event ReserveWithdrawn(bytes32 indexed seriesId, address indexed to);

    error ConfidentialCollateralVault__NotFactory();

    modifier onlyFactory() {
        if (msg.sender != factory) revert ConfidentialCollateralVault__NotFactory();
        _;
    }

    constructor(address cWETH_, address factory_) {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
        cWETH = IConfidentialCollateralToken(cWETH_);
        factory = factory_;
    }

    function depositReserve(bytes32 seriesId, address from, euint64 requestedAmount)
        external
        onlyFactory
        returns (euint64 amount)
    {
        FHE.allowTransient(requestedAmount, address(cWETH));
        amount = cWETH.confidentialTransferFrom(from, address(this), requestedAmount);

        euint64 newReserve = FHE.add(_reserves[seriesId], amount);
        _reserves[seriesId] = newReserve;
        FHE.allowThis(newReserve);
        FHE.allow(amount, msg.sender);

        emit ReserveDeposited(seriesId, from);
    }

    function withdrawReserve(bytes32 seriesId, address to, euint64 amount) external onlyFactory {
        euint64 newReserve = FHE.sub(_reserves[seriesId], amount);
        _reserves[seriesId] = newReserve;
        FHE.allowThis(newReserve);

        FHE.allow(amount, address(cWETH));
        FHE.allow(amount, to);
        cWETH.confidentialTransfer(to, amount);

        emit ReserveWithdrawn(seriesId, to);
    }

    function reserveOf(bytes32 seriesId) external view returns (euint64) {
        return _reserves[seriesId];
    }
}
