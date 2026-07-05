// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FHE, euint64, externalEuint64} from "fhevm/lib/FHE.sol";
import {PublicOptionFactory} from "../../src/public/PublicOptionFactory.sol";
import {PublicOptionToken} from "../../src/public/PublicOptionToken.sol";
import {OptionFactory} from "../../src/confidential/OptionFactory.sol";
import {OptionToken} from "../../src/confidential/OptionToken.sol";
import {ShieldBridge} from "../../src/bridge/ShieldBridge.sol";
import {
    LocalFheExecutorMock,
    LocalFheAclMock,
    LocalKmsVerifierMock,
    MockConfidentialToken
} from "../mocks/LocalFheMocks.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";

contract ShieldBridgeTest is Test {
    address constant LOCAL_ACL = 0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D;
    address constant LOCAL_EXECUTOR = 0xe3a9105a3a932253A70F126eb1E3b589C643dD24;
    address constant LOCAL_KMS = 0x901F8942346f7AB3a01F6D7613119Bca447Bb030;

    address oracle = address(0xA11CE);
    address user = address(0xB0B);
    uint256 strike = 2_000;
    uint64 maturityTimestamp;
    bytes proof = "input-proof";
    bytes validProof = "valid";
    MockEthUsdAggregator feed;

    event UnshieldRequested(
        uint256 indexed requestId,
        address indexed user,
        uint256 indexed strike,
        uint64 maturityTimestamp,
        bool isStable,
        uint64 requestedAmount,
        bytes32 burnedAmountHandle
    );

    function setUp() public {
        vm.deal(user, 100 ether);
        vm.etch(LOCAL_ACL, address(new LocalFheAclMock()).code);
        vm.etch(LOCAL_EXECUTOR, address(new LocalFheExecutorMock()).code);
        vm.etch(LOCAL_KMS, address(new LocalKmsVerifierMock()).code);
        maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        feed = new MockEthUsdAggregator(8);
        feed.setRoundData(10, 4_000e8, block.timestamp, block.timestamp, 10);
    }

    function _ext(uint64 value) internal pure returns (externalEuint64) {
        return externalEuint64.wrap(bytes32(uint256(value)));
    }

    function _plain(euint64 value) internal pure returns (uint64) {
        return uint64(uint256(FHE.toBytes32(value)));
    }

    struct Env {
        MockConfidentialToken cWETH;
        OptionFactory confFactory;
        PublicOptionFactory pubFactory;
        ShieldBridge bridge;
        OptionToken confStable;
        PublicOptionToken pubStable;
    }

    function _deployEnv(uint64 splitAmount) internal returns (Env memory env) {
        return _deployEnv(splitAmount, true);
    }

    function _deployEnvWithoutPublicSeries(uint64 splitAmount) internal returns (Env memory env) {
        return _deployEnv(splitAmount, false);
    }

    function _deployPublicSeriesOnly(uint256 splitAmount) internal returns (Env memory env) {
        env.cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        env.confFactory = new OptionFactory(address(env.cWETH), oracle, address(feed), 1 days);
        env.pubFactory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        env.bridge = new ShieldBridge(address(env.confFactory), address(env.pubFactory));
        env.pubFactory.setBridge(address(env.bridge));
        env.confFactory.setBridge(address(env.bridge));

        (address pubStableAddr,) = env.pubFactory.createSeries(strike, maturityTimestamp);
        env.bridge.authorizeSeries(strike, maturityTimestamp);
        env.pubStable = PublicOptionToken(pubStableAddr);

        vm.prank(user);
        env.pubFactory.split{value: splitAmount}(strike, maturityTimestamp, splitAmount);
    }

    function _deployEnv(uint64 splitAmount, bool createPublicSeries) internal returns (Env memory env) {
        env.cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        env.confFactory = new OptionFactory(address(env.cWETH), oracle, address(feed), 1 days);
        env.pubFactory = new PublicOptionFactory(address(0), oracle, address(feed), 1 days);
        env.bridge = new ShieldBridge(address(env.confFactory), address(env.pubFactory));
        env.pubFactory.setBridge(address(env.bridge));
        env.confFactory.setBridge(address(env.bridge));

        (address confStableAddr,) = env.confFactory.createSeries(strike, maturityTimestamp);
        address pubStableAddr;
        if (createPublicSeries) {
            (pubStableAddr,) = env.pubFactory.createSeries(strike, maturityTimestamp);
        }
        env.bridge.authorizeSeries(strike, maturityTimestamp);
        env.confStable = OptionToken(confStableAddr);
        env.pubStable = PublicOptionToken(pubStableAddr);

        env.cWETH.mintPlain(user, splitAmount);
        vm.startPrank(user);
        env.cWETH.approve(address(env.confFactory.vault()), _ext(splitAmount), proof);
        env.confFactory.split(strike, maturityTimestamp, _ext(splitAmount), proof);
        vm.stopPrank();
    }

    function testRequestEmitsBurnedAmountHandleAndFinalizeMintsVerifiedAmount() public {
        Env memory env = _deployEnv(1_000_000);

        vm.expectEmit(true, true, true, true, address(env.bridge));
        emit UnshieldRequested(0, user, strike, maturityTimestamp, true, 600_000, bytes32(uint256(600_000)));
        vm.prank(user);
        uint256 requestId = env.bridge.unshield(strike, maturityTimestamp, true, 600_000);

        assertEq(_plain(env.confStable.balanceOf(user)), 400_000);

        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(600_000)), validProof);
        assertEq(env.pubStable.balanceOf(user), 600_000);
        assertEq(env.pubStable.totalSupply(), 600_000);
    }

    function testFinalizeRejectsInvalidKmsProofAndCannotFinalizeTwice() public {
        Env memory env = _deployEnv(500_000);

        vm.prank(user);
        uint256 requestId = env.bridge.unshield(strike, maturityTimestamp, true, 250_000);

        vm.expectRevert();
        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(250_000)), "invalid");

        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(250_000)), validProof);

        vm.expectRevert(ShieldBridge.ShieldBridge__AlreadyFinalized.selector);
        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(250_000)), validProof);
    }

    function testRequestedAboveBalanceMintsOnlyActualBurnedAmount() public {
        Env memory env = _deployEnv(300_000);

        vm.prank(user);
        uint256 requestId = env.bridge.unshield(strike, maturityTimestamp, true, 900_000);

        assertEq(_plain(env.confStable.balanceOf(user)), 0);

        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(300_000)), validProof);
        assertEq(env.pubStable.balanceOf(user), 300_000);
        assertEq(env.pubStable.totalSupply(), 300_000);
    }

    function testFinalizeCreatesMissingPublicSeriesAndMints() public {
        Env memory env = _deployEnvWithoutPublicSeries(400_000);
        assertFalse(env.pubFactory.seriesExists(strike, maturityTimestamp));

        vm.prank(user);
        uint256 requestId = env.bridge.unshield(strike, maturityTimestamp, true, 400_000);

        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(400_000)), validProof);

        (address pubStableAddr,) = env.pubFactory.getTokens(strike, maturityTimestamp);
        PublicOptionToken pubStable = PublicOptionToken(pubStableAddr);
        assertTrue(env.pubFactory.seriesExists(strike, maturityTimestamp));
        assertEq(pubStable.maturityTimestamp(), maturityTimestamp);
        assertEq(pubStable.balanceOf(user), 400_000);
        assertEq(pubStable.totalSupply(), 400_000);
    }

    function testPublicMintedSupplyNeverExceedsVerifiedConfidentialBurn() public {
        Env memory env = _deployEnv(700_000);

        vm.prank(user);
        uint256 requestId = env.bridge.unshield(strike, maturityTimestamp, true, 500_000);

        vm.expectRevert();
        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(700_000)), validProof);

        env.bridge.finalizeUnshield(requestId, abi.encode(uint64(500_000)), validProof);
        assertEq(env.pubStable.totalSupply(), 500_000);
        assertLe(env.pubStable.totalSupply(), 500_000);
    }

    function testShieldBurnsPublicAndMintsConfidential() public {
        Env memory env = _deployPublicSeriesOnly(1_000_000);
        (address confStableAddr,) = env.confFactory.createSeries(strike, maturityTimestamp);
        env.bridge.authorizeSeries(strike, maturityTimestamp);
        env.confStable = OptionToken(confStableAddr);

        vm.prank(user);
        env.bridge.shield(strike, maturityTimestamp, true, 300_000);

        assertEq(env.pubStable.balanceOf(user), 700_000);
        assertEq(env.pubStable.totalSupply(), 700_000);
        assertEq(_plain(env.confStable.balanceOf(user)), 300_000);
        assertEq(_plain(env.confStable.totalSupply()), 300_000);
    }

    function testShieldCreatesMissingConfidentialSeriesAndMints() public {
        Env memory env = _deployPublicSeriesOnly(500_000);
        assertFalse(env.confFactory.seriesExists(strike, maturityTimestamp));

        vm.prank(user);
        env.bridge.shield(strike, maturityTimestamp, true, 200_000);

        (address confStableAddr,) = env.confFactory.getTokens(strike, maturityTimestamp);
        OptionToken confStable = OptionToken(confStableAddr);
        assertTrue(env.confFactory.seriesExists(strike, maturityTimestamp));
        assertEq(confStable.maturityTimestamp(), maturityTimestamp);
        assertEq(env.pubStable.balanceOf(user), 300_000);
        assertEq(_plain(confStable.balanceOf(user)), 200_000);
        assertEq(_plain(confStable.totalSupply()), 200_000);
    }
}
