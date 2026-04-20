// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {FreakingPot} from "../src/FreakingPot.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Deploys FreakingPot. Does NOT call initGame — run that separately
///         via `cast send` once you've decided per-game daily seed amounts.
///
/// Required env:
///   DEPLOY_OWNER            address that can initGame / setOperator / withdrawTreasury
///   DEPLOY_OPERATOR         hot wallet that calls rollDay() daily
///   DEPLOY_PROTOCOL_FEE     recipient of the 20% fee
///   DEPLOY_TOKEN            stablecoin used for entry fees (USDT on Celo)
///   DEPLOY_ENTRY_FEE        fee in token units (e.g. 100000 = 0.10 USDT, 6 decimals)
///
/// Usage:
///   source .env
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url celo \
///     --broadcast \
///     --verify \
///     --private-key $DEPLOYER_PRIVATE_KEY
contract Deploy is Script {
    function run() external {
        address owner = vm.envAddress("DEPLOY_OWNER");
        address operator = vm.envAddress("DEPLOY_OPERATOR");
        address protocolFee = vm.envAddress("DEPLOY_PROTOCOL_FEE");
        address token = vm.envAddress("DEPLOY_TOKEN");
        uint256 entryFee = vm.envUint("DEPLOY_ENTRY_FEE");

        vm.startBroadcast();
        FreakingPot pot = new FreakingPot(
            owner,
            operator,
            protocolFee,
            IERC20(token),
            entryFee
        );
        vm.stopBroadcast();

        console.log("FreakingPot deployed at:", address(pot));
        console.log("  owner            =", owner);
        console.log("  operator         =", operator);
        console.log("  protocolFee      =", protocolFee);
        console.log("  token            =", token);
        console.log("  entryFee (units) =", entryFee);
    }
}
