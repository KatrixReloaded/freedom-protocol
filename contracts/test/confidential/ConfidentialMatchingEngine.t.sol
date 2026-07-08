// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {FHE, euint64, ebool, externalEuint64} from "fhevm/lib/FHE.sol";
import {ZamaConfig} from "fhevm/config/ZamaConfig.sol";
import {OptionTokenBase} from "../../src/base/OptionTokenBase.sol";
import {
    ConfidentialMatchingEngine,
    IConfidentialQuoteToken as IEngineQuoteToken
} from "../../src/confidential/ConfidentialMatchingEngine.sol";
import {OptionFactory} from "../../src/confidential/OptionFactory.sol";
import {OptionToken} from "../../src/confidential/OptionToken.sol";
import {
    LocalFheAclMock,
    LocalFheExecutorMock,
    LocalKmsVerifierMock,
    MockConfidentialToken
} from "../mocks/LocalFheMocks.sol";
import {MockEthUsdAggregator} from "../mocks/MockEthUsdAggregator.sol";

contract StrictQuoteToken {
    mapping(address => euint64) private balances;
    mapping(address => mapping(address => euint64)) private allowances;

    event Transfer(address indexed from, address indexed to);
    event Approval(address indexed owner, address indexed spender);

    error StrictQuoteToken__ExternalTransferFromUsed();
    error StrictQuoteToken__WrongInternalTransferFromUsed();
    error StrictQuoteToken__WrongInternalTransferUsed();
    error StrictQuoteToken__SenderNotAllowed();

    constructor() {
        FHE.setCoprocessor(ZamaConfig.getEthereumCoprocessorConfig());
    }

    function mintPlain(address to, uint64 amount) external {
        euint64 newBalance = FHE.add(balances[to], FHE.asEuint64(amount));
        balances[to] = newBalance;
        FHE.allowThis(newBalance);
        FHE.allow(newBalance, to);
    }

    function approve(address spender, externalEuint64 encAmount, bytes calldata proof) external returns (bool) {
        euint64 amount = FHE.fromExternal(encAmount, proof);
        allowances[msg.sender][spender] = amount;
        FHE.allowThis(amount);
        FHE.allow(amount, msg.sender);
        FHE.allow(amount, spender);
        emit Approval(msg.sender, spender);
        return true;
    }

    function transferFrom(address, address, externalEuint64, bytes calldata) external pure returns (bool) {
        revert StrictQuoteToken__ExternalTransferFromUsed();
    }

    function transferFrom(address, address, euint64) external pure returns (bool) {
        revert StrictQuoteToken__WrongInternalTransferFromUsed();
    }

    function confidentialTransferFrom(address from, address to, euint64 amount) external returns (euint64 transferred) {
        if (!FHE.isSenderAllowed(amount)) revert StrictQuoteToken__SenderNotAllowed();
        euint64 currentAllowance = allowances[from][msg.sender];
        ebool ok = FHE.and(FHE.le(amount, currentAllowance), FHE.le(amount, balances[from]));
        allowances[from][msg.sender] = FHE.select(ok, FHE.sub(currentAllowance, amount), currentAllowance);
        FHE.allowThis(allowances[from][msg.sender]);
        FHE.allow(allowances[from][msg.sender], from);
        FHE.allow(allowances[from][msg.sender], msg.sender);
        transferred = _transfer(from, to, amount, ok);
        FHE.allow(transferred, msg.sender);
    }

    function transfer(address, euint64) external pure returns (bool) {
        revert StrictQuoteToken__WrongInternalTransferUsed();
    }

    function confidentialTransfer(address to, euint64 amount) external returns (euint64 transferred) {
        if (!FHE.isSenderAllowed(amount)) revert StrictQuoteToken__SenderNotAllowed();
        transferred = _transfer(msg.sender, to, amount, FHE.le(amount, balances[msg.sender]));
        FHE.allow(transferred, msg.sender);
    }

    function balanceOf(address account) external view returns (euint64) {
        return balances[account];
    }

    function plainBalanceOf(address account) external view returns (uint64) {
        return uint64(uint256(FHE.toBytes32(balances[account])));
    }

    function _transfer(address from, address to, euint64 amount, ebool ok) private returns (euint64 moved) {
        moved = FHE.select(ok, amount, FHE.asEuint64(0));
        euint64 fromBalance = FHE.sub(balances[from], moved);
        euint64 toBalance = FHE.add(balances[to], moved);

        balances[from] = fromBalance;
        balances[to] = toBalance;

        FHE.allowThis(fromBalance);
        FHE.allow(fromBalance, from);
        FHE.allowThis(toBalance);
        FHE.allow(toBalance, to);
        emit Transfer(from, to);
    }
}

contract ConfidentialMatchingEngineTest is Test {
    address constant LOCAL_ACL = 0x50157CFfD6bBFA2DECe204a89ec419c23ef5755D;
    address constant LOCAL_EXECUTOR = 0xe3a9105a3a932253A70F126eb1E3b589C643dD24;
    address constant LOCAL_KMS = 0x901F8942346f7AB3a01F6D7613119Bca447Bb030;

    address seller = address(0xB0B);
    address buyer = address(0xCAFE);
    address oracle = address(0xA11CE);
    uint256 strike = 2_000;
    uint64 maturityTimestamp;
    bytes proof = "input-proof";
    MockEthUsdAggregator feed;

    struct Env {
        MockConfidentialToken cWETH;
        MockConfidentialToken quote;
        OptionFactory factory;
        ConfidentialMatchingEngine engine;
        OptionToken stable;
        OptionToken up;
    }

    function setUp() public {
        vm.etch(LOCAL_ACL, address(new LocalFheAclMock()).code);
        vm.etch(LOCAL_EXECUTOR, address(new LocalFheExecutorMock()).code);
        vm.etch(LOCAL_KMS, address(new LocalKmsVerifierMock()).code);
        maturityTimestamp = uint64(((block.timestamp / 10 minutes) + 1) * 10 minutes);
        feed = new MockEthUsdAggregator(8);
        feed.setRoundData(10, 4_000e8, block.timestamp, block.timestamp, 10);
    }

    function testCreateListingSucceedsForStableToken() public {
        Env memory env = _deployAuthorizedEnv();
        _split(env, 1_000);

        vm.prank(seller);
        uint256 listingId = env.engine
            .createListing(
                env.stable,
                IEngineQuoteToken(address(env.quote)),
                strike,
                maturityTimestamp,
                _ext(300),
                _ext(150),
                proof,
                proof
            );

        assertEq(_plain(env.stable.balanceOf(seller)), 700);
        assertEq(_plain(env.stable.balanceOf(address(env.engine))), 300);
        (,,,,, bool active) = env.engine.getListing(listingId);
        assertTrue(active);
    }

    function testCreateListingSucceedsForUpToken() public {
        Env memory env = _deployAuthorizedEnv();
        _split(env, 1_000);

        vm.prank(seller);
        uint256 listingId = env.engine
            .createListing(
                env.up,
                IEngineQuoteToken(address(env.quote)),
                strike,
                maturityTimestamp,
                _ext(400),
                _ext(200),
                proof,
                proof
            );

        assertEq(_plain(env.up.balanceOf(seller)), 600);
        assertEq(_plain(env.up.balanceOf(address(env.engine))), 400);
        (,,,,, bool active) = env.engine.getListing(listingId);
        assertTrue(active);
    }

    function testCreateListingRevertsClearlyWhenEngineIsNotAuthorizedOnExistingSeries() public {
        Env memory env = _deployEnvWithSeriesBeforeEngine();
        _split(env, 1_000);

        vm.prank(seller);
        vm.expectRevert(OptionTokenBase.OptionTokenBase__NotAuthorized.selector);
        env.engine
            .createListing(
                env.stable,
                IEngineQuoteToken(address(env.quote)),
                strike,
                maturityTimestamp,
                _ext(300),
                _ext(150),
                proof,
                proof
            );
    }

    function testFillStillWorksAfterListingAllowanceFix() public {
        Env memory env = _deployAuthorizedEnv();
        _split(env, 1_000);
        env.quote.mintPlain(buyer, 1_000);

        vm.prank(seller);
        uint256 listingId = env.engine
            .createListing(
                env.stable,
                IEngineQuoteToken(address(env.quote)),
                strike,
                maturityTimestamp,
                _ext(300),
                _ext(150),
                proof,
                proof
            );

        vm.startPrank(buyer);
        env.quote.approve(address(env.engine), _ext(200), proof);
        env.engine.fill(listingId, _ext(200), _ext(300), proof, proof);
        vm.stopPrank();

        assertEq(_plain(env.stable.balanceOf(buyer)), 300);
        assertEq(env.quote.plainBalanceOf(seller), 150);
        assertEq(env.quote.plainBalanceOf(buyer), 850);
        (,,,,, bool active) = env.engine.getListing(listingId);
        assertFalse(active);
    }

    function testFillUsesInternalPaymentHandleForQuoteEscrow() public {
        Env memory env = _deployAuthorizedEnv();
        StrictQuoteToken quote = new StrictQuoteToken();
        _split(env, 1_000);
        quote.mintPlain(buyer, 1_000);

        vm.prank(seller);
        uint256 listingId = env.engine
            .createListing(
                env.stable,
                IEngineQuoteToken(address(quote)),
                strike,
                maturityTimestamp,
                _ext(300),
                _ext(150),
                proof,
                proof
            );

        vm.startPrank(buyer);
        quote.approve(address(env.engine), _ext(200), proof);
        env.engine.fill(listingId, _ext(200), _ext(300), proof, proof);
        vm.stopPrank();

        assertEq(_plain(env.stable.balanceOf(buyer)), 300);
        assertEq(quote.plainBalanceOf(seller), 150);
        assertEq(quote.plainBalanceOf(buyer), 850);
        (,,,,, bool active) = env.engine.getListing(listingId);
        assertFalse(active);
    }

    function testCancelListingReturnsEscrow() public {
        Env memory env = _deployAuthorizedEnv();
        _split(env, 1_000);

        vm.prank(seller);
        uint256 listingId = env.engine
            .createListing(
                env.stable,
                IEngineQuoteToken(address(env.quote)),
                strike,
                maturityTimestamp,
                _ext(300),
                _ext(150),
                proof,
                proof
            );
        assertEq(_plain(env.stable.balanceOf(seller)), 700);

        vm.prank(seller);
        env.engine.cancelListing(listingId);

        assertEq(_plain(env.stable.balanceOf(seller)), 1_000);
        assertEq(_plain(env.stable.balanceOf(address(env.engine))), 0);
        (,,,,, bool active) = env.engine.getListing(listingId);
        assertFalse(active);
    }

    function _deployAuthorizedEnv() internal returns (Env memory env) {
        env.cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        env.quote = new MockConfidentialToken("Confidential USD", "cUSD");
        env.factory = new OptionFactory(address(env.cWETH), oracle, address(feed), 1 days);
        env.engine = new ConfidentialMatchingEngine();
        env.factory.setMatchingEngine(address(env.engine));
        (address stableAddr, address upAddr) = env.factory.createSeries(strike, maturityTimestamp);
        env.stable = OptionToken(stableAddr);
        env.up = OptionToken(upAddr);
    }

    function _deployEnvWithSeriesBeforeEngine() internal returns (Env memory env) {
        env.cWETH = new MockConfidentialToken("Confidential WETH", "cWETH");
        env.quote = new MockConfidentialToken("Confidential USD", "cUSD");
        env.factory = new OptionFactory(address(env.cWETH), oracle, address(feed), 1 days);
        (address stableAddr, address upAddr) = env.factory.createSeries(strike, maturityTimestamp);
        env.engine = new ConfidentialMatchingEngine();
        env.factory.setMatchingEngine(address(env.engine));
        env.stable = OptionToken(stableAddr);
        env.up = OptionToken(upAddr);
    }

    function _split(Env memory env, uint64 amount) internal {
        env.cWETH.mintPlain(seller, amount);
        vm.startPrank(seller);
        env.cWETH.approve(address(env.factory.vault()), _ext(amount), proof);
        env.factory.split(strike, maturityTimestamp, _ext(amount), proof);
        vm.stopPrank();
    }

    function _ext(uint64 value) internal pure returns (externalEuint64) {
        return externalEuint64.wrap(bytes32(uint256(value)));
    }

    function _plain(euint64 value) internal pure returns (uint64) {
        return uint64(uint256(FHE.toBytes32(value)));
    }
}
