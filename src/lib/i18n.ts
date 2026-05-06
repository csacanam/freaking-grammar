// Runtime i18n. The app is language-switchable via LangProvider + useLang().
// Server code (API routes, cron, server components) reads the chosen lang from
// the request's ?lang=... query param and uses the helpers below.

export type Lang = "en" | "es";
export const LANGS: readonly Lang[] = ["en", "es"] as const;

export const dict = {
  en: {
    appName: "Freaking Grammar",
    tagline: "Test your grammar agility",
    tabPlay: "Home",
    tabHistory: "History",
    tabYou: "You",
    statsLinkLabel: "Live stats",
    nerdosTagline: "Games for nerdos. Daily rewards.",
    nerdosPickAGame: "Pick a game",
    grammarCardTitle: "Freaking Grammar",
    grammarCardBlurb: "Pick the right word in 5 seconds. EN + ES daily pots.",
    mathCardTitle: "Freaking Math",
    mathCardBlurb: "Daily math puzzles. Same idea, different brain muscle.",
    cardLive: "Live",
    cardSoon: "Soon",
    todaysPot: "Today's pot",
    todaysPots: "Today's pots",
    pickGame: "Pick a game",
    tapToSwitch: "Tap to switch",
    closesIn: "Closes in",
    winnerTakesAll: "Winner takes all",
    potShare: "$0.08 feeds the pot",
    leaderboard: "Leaderboard",
    todaysLeaderboard: "Today's leaderboard",
    finalStandings: "Final standings",
    noPlaysYet: "No plays yet today — be the first.",
    play: "Play",
    playFree: "Play free",
    playPaid: "Play",
    freePlayUsed: "Free play used",
    freeAgainIn: "Free again in",
    score: "Score",
    timeLeft: "Time",
    getReady: "Get ready",
    tapCorrect: "Tap the correct word",
    rulesTime: "5 seconds per question",
    rulesMiss: "One mistake ends the game",
    imReady: "I'm ready",
    rulesHint: "5s per question · top score wins",
    // Tutorial Q1 (first run ever)
    firstPlayBadge: "No clock",
    firstPlayHint: "First question — tap when you're ready. The 5s clock starts after.",
    signInWithEmail: "Sign in with email",
    useYourOwnWallet: "Use your own wallet",
    go: "GO!",
    gameOver: "Game over",
    yourScore: "Your score",
    yourRank: "Your rank",
    playAgain: "Play again",
    backToLobby: "Back to home",
    share: "Share",
    youHaveUnclaimed: "Unclaimed wins",
    claimAll: "Claim all",
    claim: "Claim",
    claimed: "Claimed",
    pastGames: "Past games",
    noHistoryYet: "No past games yet — play today.",
    stats: "Stats",
    gamesPlayed: "Games played",
    wins: "Wins",
    totalEarned: "Total earned",
    winner: "Winner",
    noWinner: "No winner",
    connecting: "Connecting…",
    connect: "Connect wallet",
    // WalletSection
    wallet: "Wallet",
    copied: "copied ✓",
    send: "Send →",
    sendToAnotherWallet: "Send to another wallet",
    sendModalHint:
      "Send {token} to any address on the Celo network — a friend, an exchange, or your own wallet.",
    sendNetworkNote:
      "This transfer happens on the Celo network. Make sure the recipient is also on Celo.",
    topUp: "Top up →",
    available: "Available",
    toAddress: "To address",
    selfAddressWarning: "That’s your own address.",
    amount: "Amount",
    max: "Max",
    sending: "Sending…",
    sendToken: "Send",
    close: "Close",
    descUSDT: "Digital US Dollar",
    descCOPm: "Digital Colombian Peso",
    descCELO: "Used for transaction fees",
    // NeedFundsModal
    notEnoughUSDT: "Not enough USDT",
    notEnoughCELO: "Not enough CELO",
    blurbUSDT: "USDT pays your entry and funds the pot.",
    blurbCELO: "CELO is the tiny fee every transaction on Celo costs.",
    hintTopUp: "Top up {token} on the Celo network to the wallet below, then try again.",
    youHave: "You have",
    youNeed: "You need",
    bridgeTo: "Bridge → {token} on Celo",
    fromOtherChains: "From Ethereum, Base, Polygon… via Squid",
    swapCeloUsdt: "Swap CELO → USDT",
    swapUsdtCelo: "Swap USDT → CELO",
    onUniswap: "On Uniswap (Celo)",
    orWithdrawFromExchange:
      "Or withdraw {token} via the Celo network from any exchange (Binance, Coinbase, OKX…).",
    // /you empty state
    youSignInTitle: "Sign in to see your stats",
    youSignInBlurb:
      "Your wins, unclaimed rewards and wallet balances appear here once you connect.",
    // Disconnect
    disconnectWallet: "Disconnect wallet",
    disconnectHint: "Switch to a different wallet to play from another account.",
    // Play stages (button label while a tx is in flight)
    stageSwitching: "Switching network…",
    stageApproving: "Approving USDT…",
    stageSigning: "Signing play…",
    stagePaying: "Paying $0.10…",
    stageStarting: "Starting…",
    // Resume banner
    resumeOne: "You have a play ready to resume",
    resumeMany: "You have {n} plays ready to resume",
    resumeTapHint: "tap to resume",
    resumeMoreAfter: "+{n} more after",
    resume: "Resume →",
    // PotCard
    extraPrize: "Extra prize",
    sponsoredBy: "Sponsored by",
    sponsorThisPot: "Sponsor this pot →",
    // Unclaimed banner
    tapToClaim: "tap to claim",
    // Claim list
    claimingStatus: "Claiming…",
    noPendingWins: "🎯  No pending wins. Go play.",
    readyBadge: "ready",
    youTag: "you",
    // Sponsor page CTA
    wantToSponsor: "Want to sponsor with your own token?",
    sponsorCtaBlurb:
      "Communities, DAOs and brands can fund bonus rewards on top of the daily pot — any Celo token, any amount, tagged with your name on the pot card.",
    talkToCamilo: "Talk to @camilosaka on Telegram →",
    // OR divider
    or: "OR",
    // Wallet section — explanatory copy for non-crypto users
    walletSubtitle: "Your money on the Celo network",
    purposeUSDT: "Used to enter paid games. Winnings are paid out in USDT.",
    purposeCOPm: "A bonus some sponsors may award, like Celo Colombia.",
    purposeCELO: "Covers the tiny fee every on-chain action costs.",
    addMoney: "Add money",
    addressHint:
      "This address is like your bank account number on Celo. Share it to receive USDT, CELO or COPm.",
    networkWarning:
      "This app only shows tokens on the Celo network.",
    // NeedFundsModal rework — three separated options
    addTokenTitle: "Add {token} to your wallet",
    receiveTitle: "Someone sends it to you",
    receiveHint:
      "This address is like your bank account number on Celo. Share it with whoever is sending you {token}.",
    bridgeTitle: "Bridge from another chain",
    bridgeHint:
      "If you already have crypto on Ethereum, Base, Polygon or another chain, move some of it over to Celo.",
    swapTitle: "Swap on Celo",
    swapHintUSDT: "If you already have CELO in your wallet, convert some into USDT here.",
    swapHintCELO: "If you already have USDT in your wallet, convert some into CELO here.",
    copyAddress: "Copy address",
  },
  es: {
    appName: "Freaking Grammar",
    tagline: "Pon a prueba tu agilidad en la gramática",
    tabPlay: "Inicio",
    tabHistory: "Historial",
    tabYou: "Tú",
    statsLinkLabel: "Estadísticas en vivo",
    nerdosTagline: "Juegos para nerdos. Recompensas diarias.",
    nerdosPickAGame: "Elige un juego",
    grammarCardTitle: "Freaking Grammar",
    grammarCardBlurb: "Elige la palabra correcta en 5 segundos. Botes diarios EN + ES.",
    mathCardTitle: "Freaking Math",
    mathCardBlurb: "Acertijos matemáticos diarios. Misma idea, otro músculo del cerebro.",
    cardLive: "En vivo",
    cardSoon: "Pronto",
    todaysPot: "Pot de hoy",
    todaysPots: "Pots de hoy",
    pickGame: "Elige un juego",
    tapToSwitch: "Toca para cambiar",
    closesIn: "Cierra en",
    winnerTakesAll: "El ganador se lo lleva",
    potShare: "$0.08 alimenta el pot",
    leaderboard: "Tabla",
    todaysLeaderboard: "Tabla de hoy",
    finalStandings: "Resultado final",
    noPlaysYet: "Aún nadie ha jugado hoy — sé el primero.",
    play: "Jugar",
    playFree: "Jugada gratis",
    playPaid: "Jugar",
    freePlayUsed: "Gratis usada",
    freeAgainIn: "Gratis en",
    score: "Puntaje",
    timeLeft: "Tiempo",
    getReady: "Prepárate",
    tapCorrect: "Toca la palabra correcta",
    rulesTime: "5 segundos por pregunta",
    rulesMiss: "Un error y se acaba",
    imReady: "Estoy listo",
    rulesHint: "5s por pregunta · mayor puntaje gana",
    // Tutorial Q1 (first run ever)
    firstPlayBadge: "Sin reloj",
    firstPlayHint: "Primera pregunta — toca cuando estés listo. El reloj de 5s arranca después.",
    signInWithEmail: "Entrar con correo",
    useYourOwnWallet: "Usar mi propia wallet",
    go: "¡YA!",
    gameOver: "Fin del juego",
    yourScore: "Tu puntaje",
    yourRank: "Tu posición",
    playAgain: "Jugar otra",
    backToLobby: "Volver al inicio",
    share: "Compartir",
    youHaveUnclaimed: "Premios sin reclamar",
    claimAll: "Reclamar todo",
    claim: "Reclamar",
    claimed: "Reclamado",
    pastGames: "Juegos anteriores",
    noHistoryYet: "Todavía no hay historial — juega hoy.",
    stats: "Estadísticas",
    gamesPlayed: "Partidas",
    wins: "Victorias",
    totalEarned: "Total ganado",
    winner: "Ganador",
    noWinner: "Sin ganador",
    connecting: "Conectando…",
    connect: "Conectar wallet",
    // WalletSection
    wallet: "Cartera",
    copied: "copiado ✓",
    send: "Enviar →",
    sendToAnotherWallet: "Enviar a otra wallet",
    sendModalHint:
      "Envía {token} a cualquier dirección en la red Celo — un amigo, un exchange o tu propia wallet.",
    sendNetworkNote:
      "Esta transferencia se hace en la red Celo. Asegúrate de que el destinatario también esté en Celo.",
    topUp: "Recargar →",
    available: "Disponible",
    toAddress: "Dirección destino",
    selfAddressWarning: "Esa es tu propia dirección.",
    amount: "Cantidad",
    max: "Máx",
    sending: "Enviando…",
    sendToken: "Enviar",
    close: "Cerrar",
    descUSDT: "Dólar digital",
    descCOPm: "Peso colombiano digital",
    descCELO: "Usado para pagar el gas",
    // NeedFundsModal
    notEnoughUSDT: "No tienes USDT suficiente",
    notEnoughCELO: "No tienes CELO suficiente",
    blurbUSDT: "El USDT paga tu entrada y alimenta el pot.",
    blurbCELO: "CELO es el pequeño fee que cuesta cada transacción en Celo.",
    hintTopUp:
      "Recarga {token} por la red Celo a la wallet de abajo y vuelve a intentar.",
    youHave: "Tienes",
    youNeed: "Necesitas",
    bridgeTo: "Bridge → {token} en Celo",
    fromOtherChains: "Desde Ethereum, Base, Polygon… vía Squid",
    swapCeloUsdt: "Cambiar CELO → USDT",
    swapUsdtCelo: "Cambiar USDT → CELO",
    onUniswap: "En Uniswap (Celo)",
    orWithdrawFromExchange:
      "O retira {token} por la red Celo desde cualquier exchange (Binance, Coinbase, OKX…).",
    // /you empty state
    youSignInTitle: "Entra para ver tus stats",
    youSignInBlurb:
      "Tus victorias, premios pendientes y saldos aparecen acá cuando te conectes.",
    // Disconnect
    disconnectWallet: "Desconectar wallet",
    disconnectHint: "Cambia a otra wallet para jugar desde otra cuenta.",
    // Play stages (button label while a tx is in flight)
    stageSwitching: "Cambiando red…",
    stageApproving: "Autorizando USDT…",
    stageSigning: "Firmando jugada…",
    stagePaying: "Pagando $0.10…",
    stageStarting: "Iniciando…",
    // Resume banner
    resumeOne: "Tienes una jugada lista para retomar",
    resumeMany: "Tienes {n} jugadas listas para retomar",
    resumeTapHint: "toca para retomar",
    resumeMoreAfter: "+{n} más después",
    resume: "Retomar →",
    // PotCard
    extraPrize: "Premio extra",
    sponsoredBy: "Patrocinado por",
    sponsorThisPot: "Patrocina este pot →",
    // Unclaimed banner
    tapToClaim: "toca para reclamar",
    // Claim list
    claimingStatus: "Reclamando…",
    noPendingWins: "🎯  No hay premios pendientes. A jugar.",
    readyBadge: "listo",
    youTag: "tú",
    // Sponsor page CTA
    wantToSponsor: "¿Quieres patrocinar con tu propio token?",
    sponsorCtaBlurb:
      "Comunidades, DAOs y marcas pueden fondear bonos adicionales encima del pot diario — cualquier token en Celo, cualquier monto, con tu nombre en el pot card.",
    talkToCamilo: "Habla con @camilosaka en Telegram →",
    // OR divider
    or: "O",
    // Wallet section — copy explicativo para no-crypto
    walletSubtitle: "Tu plata en la red Celo",
    purposeUSDT: "Se usa para entrar a juegos pagos. Las victorias se pagan en USDT.",
    purposeCOPm: "Un bono que pueden premiar sponsors, como Celo Colombia.",
    purposeCELO: "Cubre el fee mínimo que cuesta cada acción on-chain.",
    addMoney: "Agregar plata",
    addressHint:
      "Esta dirección funciona como tu número de cuenta en la red Celo. Compártela para recibir USDT, CELO o COPm.",
    networkWarning:
      "Esta app solo muestra tokens en la red Celo.",
    // NeedFundsModal rework
    addTokenTitle: "Agregar {token} a tu wallet",
    receiveTitle: "Que alguien te la envíe",
    receiveHint:
      "Esta dirección funciona como un número de cuenta en Celo. Compártela con quien te va a enviar {token}.",
    bridgeTitle: "Bridge desde otra cadena",
    bridgeHint:
      "Si ya tienes crypto en Ethereum, Base, Polygon u otra cadena, mueve algo de eso a Celo.",
    swapTitle: "Cambiar en Celo",
    swapHintUSDT: "Si ya tienes CELO en tu wallet, convierte una parte a USDT acá.",
    swapHintCELO: "Si ya tienes USDT en tu wallet, convierte una parte a CELO acá.",
    copyAddress: "Copiar dirección",
  },
} as const;

export type Strings = (typeof dict)[Lang];

/** Narrow any string to a valid Lang, defaulting to "en". */
export function validateLang(s: string | null | undefined): Lang {
  return s === "es" ? "es" : "en";
}

/** Contract gameId for a given language (matches the initGame calls). */
export function gameIdFor(lang: Lang): 1 | 2 {
  return lang === "en" ? 1 : 2;
}

/** Tiny template-style interpolator for dict strings with `{key}` slots. */
export function tpl(
  str: string,
  vars: Record<string, string | number>,
): string {
  return str.replace(/\{(\w+)\}/g, (_, k) =>
    vars[k] !== undefined ? String(vars[k]) : `{${k}}`,
  );
}
