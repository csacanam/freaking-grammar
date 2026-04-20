// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import "forge-std/Test.sol";
import {FreakingPot} from "../src/FreakingPot.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockUSDT is ERC20 {
    constructor() ERC20("MockUSDT", "USDT") {}
    function decimals() public pure override returns (uint8) { return 6; }
    function mint(address to, uint256 amt) external { _mint(to, amt); }
}

contract FreakingPotTest is Test {
    FreakingPot pot;
    MockUSDT token;
    address owner = address(0xA11CE);
    address operator = address(0x0BCD);
    address protocolFee = address(0xFEE);
    address alice = address(0x1);
    address bob = address(0x2);

    uint256 constant ENTRY_FEE = 100_000;            // 0.10 USDT (6 decimals)
    uint256 constant SEED = 1_000_000;               // 1 USDT
    uint256 constant GAME_EN = 1;

    function setUp() public {
        token = new MockUSDT();
        vm.prank(owner);
        pot = new FreakingPot(owner, operator, protocolFee, IERC20(address(token)), ENTRY_FEE);
        vm.prank(owner);
        pot.initGame(GAME_EN, SEED);

        // owner funds treasury
        token.mint(owner, 100 * 1e6);
        vm.startPrank(owner);
        token.approve(address(pot), type(uint256).max);
        pot.fundTreasury(GAME_EN, 30 * 1e6); // 30 USDT runway
        vm.stopPrank();

        // alice + bob each get 5 USDT and approve
        token.mint(alice, 5 * 1e6);
        token.mint(bob, 5 * 1e6);
        vm.prank(alice); token.approve(address(pot), type(uint256).max);
        vm.prank(bob);   token.approve(address(pot), type(uint256).max);
    }

    function test_freePlayThenPaid() public {
        vm.prank(alice);
        bool wasFree = pot.play(GAME_EN);
        assertTrue(wasFree);
        assertEq(pot.viewPot(GAME_EN, 1), 0);

        vm.prank(alice);
        bool wasFree2 = pot.play(GAME_EN);
        assertFalse(wasFree2);
        // 80% of 0.10 = 0.08 USDT to pot, 0.02 to protocol
        assertEq(pot.viewPot(GAME_EN, 1), 80_000);
        assertEq(token.balanceOf(protocolFee), 20_000);
    }

    function test_rollDaySeedsAndDeclaresWinner() public {
        // alice plays paid -> pot has 0.08
        vm.startPrank(alice);
        pot.play(GAME_EN); // free
        pot.play(GAME_EN); // paid
        vm.stopPrank();
        assertEq(pot.viewPot(GAME_EN, 1), 80_000);

        // operator rolls day 1, declares alice winner, opens day 2 with 1 USDT seed
        vm.prank(operator);
        pot.rollDay(GAME_EN, alice);

        assertEq(pot.currentDay(GAME_EN), 2);
        assertEq(pot.winnerOf(GAME_EN, 1), alice);
        assertEq(pot.viewPot(GAME_EN, 2), SEED);
        assertEq(pot.treasury(GAME_EN), 30 * 1e6 - SEED);
    }

    function test_claim() public {
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();

        vm.prank(operator);
        pot.rollDay(GAME_EN, alice);

        uint256 before = token.balanceOf(alice);
        vm.prank(alice);
        pot.claim(1, GAME_EN);
        assertEq(token.balanceOf(alice) - before, 80_000);
        assertTrue(pot.claimed(GAME_EN, 1));
    }

    function test_claimMultiple() public {
        // day 1 winner = alice
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        vm.prank(operator); pot.rollDay(GAME_EN, alice);

        // day 2 winner = alice again
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        vm.prank(operator); pot.rollDay(GAME_EN, alice);

        uint256 before = token.balanceOf(alice);
        uint256[] memory days_ = new uint256[](2);
        days_[0] = 1; days_[1] = 2;
        vm.prank(alice);
        pot.claimMultiple(days_, GAME_EN);
        // day 1 = 0.08 (only paid), day 2 = SEED + 0.08
        assertEq(token.balanceOf(alice) - before, 80_000 + SEED + 80_000);
    }

    function test_nonWinnerCannotClaim() public {
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        vm.prank(operator); pot.rollDay(GAME_EN, alice);

        vm.prank(bob);
        vm.expectRevert(FreakingPot.NotWinner.selector);
        pot.claim(1, GAME_EN);
    }

    function test_treasuryRunsOutGracefully() public {
        // drain treasury via withdraw
        vm.prank(owner);
        pot.withdrawTreasury(GAME_EN, 30 * 1e6, owner);

        vm.prank(operator);
        pot.rollDay(GAME_EN, address(0));
        // pot of new day starts at 0, no revert
        assertEq(pot.viewPot(GAME_EN, 2), 0);
    }

    function test_rollDayCarriesOverPotWhenNoWinner() public {
        // alice plays paid → pot[1] has 80_000
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        assertEq(pot.viewPot(GAME_EN, 1), 80_000);

        uint256 treasuryBefore = pot.treasury(GAME_EN);

        // no winner → closed pot rolls forward, treasury untouched
        vm.prank(operator);
        pot.rollDay(GAME_EN, address(0));

        assertEq(pot.viewPot(GAME_EN, 1), 0);
        assertEq(pot.viewPot(GAME_EN, 2), 80_000);
        assertEq(pot.treasury(GAME_EN), treasuryBefore);
    }

    function test_rollDayCarryOverCompoundsAcrossGhostDays() public {
        // day 1: alice paid → 80_000 in pot
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();

        // roll day 1 with no winner → carry to day 2
        vm.prank(operator);
        pot.rollDay(GAME_EN, address(0));
        assertEq(pot.viewPot(GAME_EN, 2), 80_000);

        // roll day 2 with no winner (nobody played day 2 either) → carry to day 3
        vm.prank(operator);
        pot.rollDay(GAME_EN, address(0));
        assertEq(pot.viewPot(GAME_EN, 2), 0);
        assertEq(pot.viewPot(GAME_EN, 3), 80_000);
    }

    function test_protocolFeeRoutedToRecipient() public {
        // alice paid play → 20_000 (20%) to protocolFee, 80_000 (80%) to pot
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        assertEq(token.balanceOf(protocolFee), 20_000);
        assertEq(pot.viewPot(GAME_EN, 1), 80_000);
    }

    function test_ownerCanChangeProtocolFeeRecipient() public {
        address newFee = address(0xDEADBEEF);
        vm.prank(owner);
        pot.setProtocolFeeRecipient(newFee);

        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        assertEq(token.balanceOf(newFee), 20_000);
        assertEq(token.balanceOf(protocolFee), 0);
    }

    function test_rollDayDrawsTreasuryOnGhostDayWithEmptyPot() public {
        // No plays on day 1 → pot[1] stays 0. Treasury funded.
        assertEq(pot.viewPot(GAME_EN, 1), 0);
        uint256 treasuryBefore = pot.treasury(GAME_EN);

        vm.prank(operator);
        pot.rollDay(GAME_EN, address(0));

        // Day 2 should be seeded from treasury (bug fix — else branch fires
        // when closedPot == 0 even with no winner).
        assertEq(pot.viewPot(GAME_EN, 2), SEED);
        assertEq(pot.treasury(GAME_EN), treasuryBefore - SEED);
    }

    function test_seedCurrentDayFillsPotFromTreasury() public {
        assertEq(pot.viewPot(GAME_EN, 1), 0);
        uint256 treasuryBefore = pot.treasury(GAME_EN);

        vm.prank(operator);
        pot.seedCurrentDay(GAME_EN);

        assertEq(pot.viewPot(GAME_EN, 1), SEED);
        assertEq(pot.treasury(GAME_EN), treasuryBefore - SEED);
    }

    function test_seedCurrentDayBackfillsPartialPot() public {
        // alice plays paid → pot[1] has 80_000
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        assertEq(pot.viewPot(GAME_EN, 1), 80_000);

        uint256 treasuryBefore = pot.treasury(GAME_EN);
        vm.prank(operator);
        pot.seedCurrentDay(GAME_EN);

        // Fills the gap (SEED - 80_000) from treasury.
        assertEq(pot.viewPot(GAME_EN, 1), SEED);
        assertEq(pot.treasury(GAME_EN), treasuryBefore - (SEED - 80_000));
    }

    function test_seedCurrentDayRevertsWhenAlreadyAtSeed() public {
        // Seed once.
        vm.prank(operator);
        pot.seedCurrentDay(GAME_EN);

        // Second call should revert.
        vm.prank(operator);
        vm.expectRevert(FreakingPot.AlreadySeeded.selector);
        pot.seedCurrentDay(GAME_EN);
    }

    function test_seedCurrentDayRevertsWhenTreasuryEmpty() public {
        // Drain treasury.
        vm.prank(owner);
        pot.withdrawTreasury(GAME_EN, 30 * 1e6, owner);

        vm.prank(operator);
        vm.expectRevert(FreakingPot.NothingToSeed.selector);
        pot.seedCurrentDay(GAME_EN);
    }

    function test_initGameRevertsIfAlreadyInitialized() public {
        vm.prank(owner);
        vm.expectRevert(FreakingPot.AlreadyInitialized.selector);
        pot.initGame(GAME_EN, SEED);
    }

    function test_sponsorPotBoostsCurrentDay() public {
        // Celo (bob here) sponsors today's pot with $5.
        address celo = bob;
        token.mint(celo, 10 * 1e6);

        vm.startPrank(celo);
        token.approve(address(pot), type(uint256).max);
        pot.sponsorPot(GAME_EN, 5 * 1e6);
        vm.stopPrank();

        assertEq(pot.viewPot(GAME_EN, 1), 5 * 1e6);
        // Treasury untouched (sponsor pulls from their own balance)
        assertEq(pot.treasury(GAME_EN), 30 * 1e6);
    }

    function test_sponsorPotStacksWithPlaysAndSeed() public {
        // alice plays paid → pot has 80_000
        vm.startPrank(alice);
        pot.play(GAME_EN); pot.play(GAME_EN);
        vm.stopPrank();
        assertEq(pot.viewPot(GAME_EN, 1), 80_000);

        // operator seeds from treasury → pot has SEED
        vm.prank(operator);
        pot.seedCurrentDay(GAME_EN);
        assertEq(pot.viewPot(GAME_EN, 1), SEED);

        // sponsor adds $5 on top
        token.mint(bob, 10 * 1e6);
        vm.startPrank(bob);
        token.approve(address(pot), type(uint256).max);
        pot.sponsorPot(GAME_EN, 5 * 1e6);
        vm.stopPrank();

        // Winner eventually takes everything.
        assertEq(pot.viewPot(GAME_EN, 1), SEED + 5 * 1e6);
    }

    function test_sponsorPotRevertsOnZero() public {
        vm.prank(bob);
        vm.expectRevert(FreakingPot.InvalidAmount.selector);
        pot.sponsorPot(GAME_EN, 0);
    }
}
