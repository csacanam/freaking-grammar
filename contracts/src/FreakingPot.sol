// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title FreakingPot
/// @notice Daily winner-takes-all pot per game (gameId 1 = English, 2 = Spanish, ...).
///         Players pay an entry fee in a stablecoin (USDT). 80% feeds the day's pot,
///         20% is the protocol fee. Each wallet gets one free play per UTC day per game.
///         At 00:00 UTC the operator calls `rollDay` to close yesterday and open today,
///         seeding the new pot from the per-game treasury. Winners claim later.
contract FreakingPot is Ownable {
    using SafeERC20 for IERC20;

    // --- immutable / config ---
    IERC20 public immutable token;            // stablecoin used for entry fees + payouts
    uint256 public immutable entryFee;        // e.g. 0.10 USDT = 100_000 (6 decimals)
    uint256 public constant FEE_BPS = 2000;   // 20% protocol fee, 80% to pot
    uint256 public constant BPS_DENOM = 10_000;

    // --- privileged actors ---
    address public operator;                  // hot wallet that calls rollDay daily
    address public protocolFeeRecipient;      // wallet that collects the 20%

    // --- per-game state (gameId => ...) ---
    mapping(uint256 => uint256) public treasury;       // funds owner pre-loaded for seeding
    mapping(uint256 => uint256) public dailySeed;      // amount moved into the new pot per day
    mapping(uint256 => uint256) public currentDay;     // day counter, increments on rollDay
    mapping(uint256 => uint256) public dayStartedAt;   // unix ts of currentDay's start

    // gameId => day => pot amount
    mapping(uint256 => mapping(uint256 => uint256)) public pot;
    // gameId => day => winner (set on rollDay of the next day)
    mapping(uint256 => mapping(uint256 => address)) public winnerOf;
    // gameId => day => claimed
    mapping(uint256 => mapping(uint256 => bool)) public claimed;
    // gameId => user => last day they used the free play (current = used today)
    mapping(uint256 => mapping(address => uint256)) public lastFreePlayDay;

    // --- events ---
    event GameInitialized(uint256 indexed gameId, uint256 dailySeed);
    event TreasuryFunded(uint256 indexed gameId, address indexed from, uint256 amount);
    event TreasuryWithdrawn(uint256 indexed gameId, address indexed to, uint256 amount);
    event DailySeedUpdated(uint256 indexed gameId, uint256 amount);
    event Played(uint256 indexed gameId, uint256 indexed day, address indexed player, bool wasFree, uint256 potAfter);
    event DayRolled(uint256 indexed gameId, uint256 indexed closedDay, address closedWinner, uint256 closedPot, uint256 indexed newDay, uint256 seeded);
    event Claimed(uint256 indexed gameId, uint256 indexed day, address indexed winner, uint256 amount);
    event WinnerOverridden(uint256 indexed gameId, uint256 indexed day, address newWinner);
    event OperatorChanged(address indexed newOperator);
    event ProtocolFeeRecipientChanged(address indexed newRecipient);
    event DaySeeded(uint256 indexed gameId, uint256 indexed day, uint256 amount);
    event PotSponsored(uint256 indexed gameId, uint256 indexed day, address indexed sponsor, uint256 amount);

    // --- errors ---
    error NotOperator();
    error GameNotInitialized();
    error AlreadyInitialized();
    error AlreadyClaimed();
    error AlreadySeeded();
    error NothingToSeed();
    error NotWinner();
    error NothingToClaim();
    error ZeroAddress();
    error InvalidAmount();

    modifier onlyOperator() {
        if (msg.sender != operator && msg.sender != owner()) revert NotOperator();
        _;
    }

    constructor(
        address _owner,
        address _operator,
        address _protocolFeeRecipient,
        IERC20 _token,
        uint256 _entryFee
    ) Ownable(_owner) {
        if (_operator == address(0) || _protocolFeeRecipient == address(0) || address(_token) == address(0)) {
            revert ZeroAddress();
        }
        operator = _operator;
        protocolFeeRecipient = _protocolFeeRecipient;
        token = _token;
        entryFee = _entryFee;
    }

    // ---------------------------------------------------------------- admin

    function initGame(uint256 gameId, uint256 _dailySeed) external onlyOwner {
        if (currentDay[gameId] != 0) revert AlreadyInitialized();
        currentDay[gameId] = 1;
        dayStartedAt[gameId] = block.timestamp;
        dailySeed[gameId] = _dailySeed;
        emit GameInitialized(gameId, _dailySeed);
    }

    function setOperator(address newOperator) external onlyOwner {
        if (newOperator == address(0)) revert ZeroAddress();
        operator = newOperator;
        emit OperatorChanged(newOperator);
    }

    function setProtocolFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert ZeroAddress();
        protocolFeeRecipient = newRecipient;
        emit ProtocolFeeRecipientChanged(newRecipient);
    }

    function setDailySeed(uint256 gameId, uint256 amount) external onlyOwner {
        dailySeed[gameId] = amount;
        emit DailySeedUpdated(gameId, amount);
    }

    /// @notice Owner can correct a wrongly-declared winner before claim happens.
    function overrideWinner(uint256 gameId, uint256 day, address newWinner) external onlyOwner {
        if (claimed[gameId][day]) revert AlreadyClaimed();
        winnerOf[gameId][day] = newWinner;
        emit WinnerOverridden(gameId, day, newWinner);
    }

    // -------------------------------------------------------------- treasury

    /// @notice Anyone can pre-fund the treasury for a game; usually the owner.
    function fundTreasury(uint256 gameId, uint256 amount) external {
        if (amount == 0) revert InvalidAmount();
        token.safeTransferFrom(msg.sender, address(this), amount);
        treasury[gameId] += amount;
        emit TreasuryFunded(gameId, msg.sender, amount);
    }

    function withdrawTreasury(uint256 gameId, uint256 amount, address to) external onlyOwner {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0 || amount > treasury[gameId]) revert InvalidAmount();
        treasury[gameId] -= amount;
        token.safeTransfer(to, amount);
        emit TreasuryWithdrawn(gameId, to, amount);
    }

    /// @notice Tops up the current day's pot from the treasury, up to `dailySeed`.
    ///         Main use case: bootstrap after initGame when the first day opens
    ///         with pot=0 and treasury gets funded afterwards. Can also backfill
    ///         a day that opened before treasury had enough. Reverts if the pot
    ///         already meets `dailySeed` or if there's nothing to seed.
    function seedCurrentDay(uint256 gameId) external onlyOperator {
        uint256 day = currentDay[gameId];
        if (day == 0) revert GameNotInitialized();

        uint256 current = pot[gameId][day];
        uint256 seed = dailySeed[gameId];
        if (current >= seed) revert AlreadySeeded();

        uint256 gap = seed - current;
        uint256 available = treasury[gameId];
        uint256 amount = gap <= available ? gap : available;
        if (amount == 0) revert NothingToSeed();

        treasury[gameId] -= amount;
        pot[gameId][day] += amount;
        emit DaySeeded(gameId, day, amount);
    }

    /// @notice Permissionless sponsorship — anyone can deposit USDT directly
    ///         into the current day's pot. No cap, no treasury involvement.
    ///         Main use case: a protocol (e.g. a chain ecosystem fund) boosts
    ///         a day to drive activity. Funds flow straight to the winner.
    function sponsorPot(uint256 gameId, uint256 amount) external {
        uint256 day = currentDay[gameId];
        if (day == 0) revert GameNotInitialized();
        if (amount == 0) revert InvalidAmount();

        token.safeTransferFrom(msg.sender, address(this), amount);
        pot[gameId][day] += amount;
        emit PotSponsored(gameId, day, msg.sender, amount);
    }

    // ------------------------------------------------------------------ play

    /// @notice Enter today's pot. First call per UTC day per (gameId, user) is free.
    /// @return wasFree true if this play used the free daily allowance.
    function play(uint256 gameId) external returns (bool wasFree) {
        uint256 day = currentDay[gameId];
        if (day == 0) revert GameNotInitialized();

        if (lastFreePlayDay[gameId][msg.sender] < day) {
            // Free play — counts in the leaderboard but doesn't fund the pot.
            lastFreePlayDay[gameId][msg.sender] = day;
            wasFree = true;
        } else {
            // Paid play — 80% to pot, 20% to protocol.
            uint256 fee = entryFee;
            token.safeTransferFrom(msg.sender, address(this), fee);
            uint256 protocolCut = (fee * FEE_BPS) / BPS_DENOM;
            uint256 potCut = fee - protocolCut;
            pot[gameId][day] += potCut;
            token.safeTransfer(protocolFeeRecipient, protocolCut);
            wasFree = false;
        }

        emit Played(gameId, day, msg.sender, wasFree, pot[gameId][day]);
    }

    // -------------------------------------------------------------- rollover

    /// @notice Operator (or owner) closes yesterday with its winner and opens today.
    ///         If a winner was declared, the closed pot stays put for them to
    ///         claim and the new day is seeded fresh from `treasury` (up to
    ///         `dailySeed`). If no winner (address(0)) — e.g. ghost day where
    ///         nobody played — the closed pot rolls over into the new day and
    ///         the treasury isn't drained. Keeps money from getting stuck.
    /// @param gameId the game to roll
    /// @param winnerOfClosedDay address that won the day being closed; address(0) = no winner
    function rollDay(uint256 gameId, address winnerOfClosedDay) external onlyOperator {
        uint256 closedDay = currentDay[gameId];
        if (closedDay == 0) revert GameNotInitialized();

        winnerOf[gameId][closedDay] = winnerOfClosedDay;

        uint256 newDay = closedDay + 1;
        currentDay[gameId] = newDay;
        dayStartedAt[gameId] = block.timestamp;

        uint256 closedPot = pot[gameId][closedDay];
        uint256 toSeed;

        if (winnerOfClosedDay == address(0) && closedPot > 0) {
            // Ghost day with a pot — carry forward, skip the treasury draw.
            pot[gameId][closedDay] = 0;
            toSeed = closedPot;
        } else {
            // Winner claims the closed pot, OR there was nothing to carry
            // (empty ghost day). Either way, seed the new day from treasury.
            uint256 seed = dailySeed[gameId];
            uint256 available = treasury[gameId];
            toSeed = seed <= available ? seed : available;
            if (toSeed > 0) treasury[gameId] -= toSeed;
        }

        if (toSeed > 0) pot[gameId][newDay] += toSeed;

        emit DayRolled(gameId, closedDay, winnerOfClosedDay, closedPot, newDay, toSeed);
    }

    // ----------------------------------------------------------------- claim

    function claim(uint256 day, uint256 gameId) external {
        _claim(day, gameId);
    }

    function claimMultiple(uint256[] calldata days_, uint256 gameId) external {
        uint256 len = days_.length;
        for (uint256 i = 0; i < len; ++i) {
            _claim(days_[i], gameId);
        }
    }

    function _claim(uint256 day, uint256 gameId) internal {
        if (claimed[gameId][day]) revert AlreadyClaimed();
        if (winnerOf[gameId][day] != msg.sender) revert NotWinner();
        uint256 amount = pot[gameId][day];
        if (amount == 0) revert NothingToClaim();
        claimed[gameId][day] = true;
        token.safeTransfer(msg.sender, amount);
        emit Claimed(gameId, day, msg.sender, amount);
    }

    // ------------------------------------------------------------------ view

    function viewPot(uint256 gameId, uint256 day) external view returns (uint256) {
        return pot[gameId][day];
    }

    function hasFreePlayToday(uint256 gameId, address user) external view returns (bool) {
        return lastFreePlayDay[gameId][user] < currentDay[gameId];
    }

    function unclaimed(uint256[] calldata days_, uint256 gameId, address user)
        external
        view
        returns (uint256 totalAmount, uint256 count)
    {
        uint256 len = days_.length;
        for (uint256 i = 0; i < len; ++i) {
            uint256 d = days_[i];
            if (winnerOf[gameId][d] == user && !claimed[gameId][d]) {
                totalAmount += pot[gameId][d];
                ++count;
            }
        }
    }
}
