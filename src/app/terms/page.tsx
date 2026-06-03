"use client";

import Link from "next/link";
import { useLang } from "@/lib/lang-provider";

// Plain-English / Spanish Terms of Service. Kept short on purpose —
// scope of data and risk on nerdos.fun is small (no fiat, no PII beyond
// optional email, on-chain settlement), so a 200-paragraph corporate
// template would be misleading. If the legal surface grows (KYC, fiat
// rails, B2B sponsors with contracts) revisit.

export default function TermsPage() {
  const { uiLang } = useLang();
  return (
    <article className="max-w-2xl mx-auto w-full px-5 pt-8 pb-24">
      {uiLang === "es" ? <TermsES /> : <TermsEN />}
      <p className="mt-10">
        <Link
          href="/you"
          className="text-sm font-display tracking-widest uppercase text-muted hover:text-ink"
        >
          ← nerdos.fun
        </Link>
      </p>
    </article>
  );
}

function TermsEN() {
  return (
    <div className="text-[15px] leading-relaxed text-ink flex flex-col gap-4">
      <h1 className="font-display text-3xl tracking-wide mb-1">
        Terms of Service
      </h1>
      <p className="text-xs text-muted">Last updated: 2026-06-03</p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        1. What nerdos.fun is
      </h2>
      <p>
        nerdos.fun is a platform for daily skill-based mini-games on the Celo
        blockchain. Each day there is a USDT prize pot for each game (Grammar
        EN, Grammar ES, Math). You can play one round per day for free, or pay
        a small USDT entry fee to play again. The player with the highest score
        at midnight UTC wins the pot, settled automatically by an on-chain
        smart contract.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">2. Eligibility</h2>
      <p>
        You must be at least 18 years old, or the age of majority in your
        jurisdiction. nerdos.fun is not available in jurisdictions where
        skill-based prize games are prohibited.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">3. Prizes</h2>
      <p>
        Prizes are denominated in USDT and distributed by a verified smart
        contract on Celo. We do not custody player funds at any point. If a
        sponsor is running an active bonus campaign, the daily winner may also
        receive sponsor tokens (such as COPm). Sponsor bonuses are best-effort
        and may end without notice when the sponsor budget is exhausted.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        4. Wallet and account
      </h2>
      <p>
        You bring your own wallet — a Privy-provisioned embedded wallet via
        email, or a self-custody wallet (MetaMask, Rabby, MiniPay, Farcaster,
        etc.). You are responsible for your private keys and recovery method.
        We cannot recover lost keys or reverse transactions.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">5. Fair play</h2>
      <p>
        We use timing and pattern heuristics, plus on-chain analytics, to
        detect bot-like behavior. Wallets that show bot signatures may be
        excluded from prize distribution without prior notice. If you believe
        your wallet was wrongly flagged, contact us.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">6. No warranty</h2>
      <p>
        nerdos.fun is provided <em>as is</em>. We do not guarantee
        uninterrupted service, error-free game logic, or correctness of pot
        distribution beyond best effort. The smart contract code is verified
        on Celoscan and you can inspect it before playing.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        7. Blockchain risk
      </h2>
      <p>
        All on-chain transactions are final. Smart contracts may contain bugs.
        Network fees exist in most clients (they are abstracted away inside
        MiniPay). We are not liable for losses resulting from network fees,
        contract bugs, network outages, or wallet compromise.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        8. Modifications
      </h2>
      <p>
        We may update game rules, entry fees, prize amounts, supported tokens,
        or these terms at any time. Material changes will be surfaced in the
        app.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">9. Termination</h2>
      <p>
        We can disable access for accounts that violate these terms or that we
        determine, in good faith, are abusing the system.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">10. Contact</h2>
      <p>
        Questions or disputes:{" "}
        <a className="underline" href="mailto:hi@sakalabs.io">
          hi@sakalabs.io
        </a>
        .
      </p>
    </div>
  );
}

function TermsES() {
  return (
    <div className="text-[15px] leading-relaxed text-ink flex flex-col gap-4">
      <h1 className="font-display text-3xl tracking-wide mb-1">
        Términos de servicio
      </h1>
      <p className="text-xs text-muted">Última actualización: 2026-06-03</p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        1. Qué es nerdos.fun
      </h2>
      <p>
        nerdos.fun es una plataforma de mini-juegos diarios de habilidad sobre
        la blockchain de Celo. Cada día hay un premio en USDT por juego
        (Gramática EN, Gramática ES, Matemáticas). Puedes jugar una ronda
        gratis al día o pagar una pequeña entrada en USDT para jugar otra. El
        jugador con el puntaje más alto al cierre del día UTC gana el premio,
        liquidado automáticamente por un contrato inteligente on-chain.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">2. Elegibilidad</h2>
      <p>
        Debes tener al menos 18 años, o la mayoría de edad en tu jurisdicción.
        nerdos.fun no está disponible donde los juegos de habilidad con premio
        estén prohibidos.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">3. Premios</h2>
      <p>
        Los premios están denominados en USDT y los distribuye un contrato
        inteligente verificado en Celo. En ningún momento custodiamos fondos
        de jugadores. Si un sponsor tiene una campaña activa, el ganador
        diario puede recibir además tokens del sponsor (por ejemplo COPm). Los
        bonos de sponsor son de mejor esfuerzo y pueden terminar sin aviso
        cuando el presupuesto del sponsor se agota.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        4. Wallet y cuenta
      </h2>
      <p>
        Tú traes tu propia wallet — una wallet embebida de Privy vía email, o
        una wallet de auto-custodia (MetaMask, Rabby, MiniPay, Farcaster,
        etc.). Tú eres responsable de tus llaves privadas y método de
        recuperación. No podemos recuperar llaves perdidas ni revertir
        transacciones.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">5. Juego limpio</h2>
      <p>
        Usamos heurísticas de tiempos y patrones, además de analítica
        on-chain, para detectar comportamiento de bot. Las wallets con
        firma de bot pueden quedar excluidas de la distribución de premios
        sin aviso previo. Si crees que tu wallet fue marcada por error,
        contáctanos.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">6. Sin garantía</h2>
      <p>
        nerdos.fun se ofrece <em>tal cual</em>. No garantizamos servicio
        ininterrumpido, lógica de juego libre de errores, ni distribución
        perfecta de los premios más allá de nuestro mejor esfuerzo. El código
        del contrato inteligente está verificado en Celoscan y puedes
        inspeccionarlo antes de jugar.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        7. Riesgo blockchain
      </h2>
      <p>
        Todas las transacciones on-chain son finales. Los contratos
        inteligentes pueden tener bugs. Las tarifas de red existen en la
        mayoría de los clientes (en MiniPay quedan abstraídas). No somos
        responsables por pérdidas derivadas de tarifas de red, bugs de
        contrato, caídas de red o compromiso de wallet.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        8. Modificaciones
      </h2>
      <p>
        Podemos actualizar las reglas del juego, las tarifas de entrada, los
        premios, los tokens soportados o estos términos en cualquier momento.
        Cambios materiales se mostrarán en la app.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">9. Terminación</h2>
      <p>
        Podemos deshabilitar el acceso a cuentas que violen estos términos o
        que, de buena fe, determinemos que están abusando del sistema.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">10. Contacto</h2>
      <p>
        Dudas o disputas:{" "}
        <a className="underline" href="mailto:hi@sakalabs.io">
          hi@sakalabs.io
        </a>
        .
      </p>
    </div>
  );
}
