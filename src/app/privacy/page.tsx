"use client";

import Link from "next/link";
import { useLang } from "@/lib/lang-provider";

// Plain-language Privacy Policy. nerdos.fun collects very little (optional
// email, on-chain wallet address, gameplay timing, PostHog analytics) so
// the policy is intentionally short. The vendor list is the only thing
// that grows — keep it in sync with package.json + .env.local when new
// services are added.

export default function PrivacyPage() {
  const { uiLang } = useLang();
  return (
    <article className="max-w-2xl mx-auto w-full px-5 pt-8 pb-24">
      {uiLang === "es" ? <PrivacyES /> : <PrivacyEN />}
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

function PrivacyEN() {
  return (
    <div className="text-[15px] leading-relaxed text-ink flex flex-col gap-4">
      <h1 className="font-display text-3xl tracking-wide mb-1">Privacy</h1>
      <p className="text-xs text-muted">Last updated: 2026-06-03</p>

      <h2 className="font-display text-xl tracking-wide mt-4">What we collect</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Email address</strong> — only if you sign in with email via
          Privy. We don&apos;t collect email from self-custody wallet logins.
        </li>
        <li>
          <strong>Wallet address</strong> — the public on-chain identifier you
          use to play.
        </li>
        <li>
          <strong>Game data</strong> — questions served, answers chosen,
          timing, scores. Powers leaderboards and bot detection.
        </li>
        <li>
          <strong>Analytics</strong> — visitor counts, country (via IP), device
          type, traffic source. Collected via PostHog.
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">
        What we don&apos;t collect
      </h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>Real name, phone, government ID, KYC documents.</li>
        <li>Card or bank information (we transact in USDT, not fiat).</li>
        <li>Browsing activity outside nerdos.fun.</li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">
        Why we collect it
      </h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Email</strong> — daily game reminders and support replies.
        </li>
        <li>
          <strong>Wallet</strong> — identify your plays and route prizes
          on-chain.
        </li>
        <li>
          <strong>Game data</strong> — leaderboards, anti-cheat, game-balance
          improvements.
        </li>
        <li>
          <strong>Analytics</strong> — understand traffic, fix UX issues, plan
          per-country availability.
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">
        Who we share it with
      </h2>
      <p>We use these service providers:</p>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Privy</strong> — authentication and embedded-wallet
          provisioning
        </li>
        <li>
          <strong>Supabase</strong> — database hosting
        </li>
        <li>
          <strong>Vercel</strong> — application hosting
        </li>
        <li>
          <strong>SendGrid / Resend</strong> — email delivery
        </li>
        <li>
          <strong>Cloudflare Turnstile</strong> — anti-bot verification
        </li>
        <li>
          <strong>PostHog</strong> — product analytics
        </li>
        <li>
          <strong>Alchemy / Forno</strong> — Celo RPC providers
        </li>
      </ul>
      <p>
        Your wallet address and game outcomes are public on the Celo
        blockchain by design — anyone with on-chain access can see them. We
        also publish aggregated, non-identifying statistics at{" "}
        <Link href="/stats" className="underline">
          /stats
        </Link>
        .
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">
        Data retention
      </h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Email</strong>: kept until you unsubscribe or request
          deletion.
        </li>
        <li>
          <strong>Game data</strong>: kept indefinitely. Smart contract data
          is immutable.
        </li>
        <li>
          <strong>Analytics</strong>: PostHog default retention (~90 days).
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">Your rights</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Unsubscribe</strong> from emails: every email has an
          unsubscribe link.
        </li>
        <li>
          <strong>Delete</strong> your email + analytics records: email us.
          On-chain data cannot be deleted (immutable by design).
        </li>
        <li>
          <strong>Access</strong> your data: email us and we&apos;ll send what
          we have.
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">Cookies</h2>
      <p>
        We use minimal cookies for session management and PostHog analytics.
        No advertising trackers.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">Children</h2>
      <p>nerdos.fun is not intended for users under 18.</p>

      <h2 className="font-display text-xl tracking-wide mt-4">Changes</h2>
      <p>
        We will update this page when the policy changes and surface material
        changes in the app.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">Contact</h2>
      <p>
        <a className="underline" href="mailto:hi@sakalabs.io">
          hi@sakalabs.io
        </a>
      </p>
    </div>
  );
}

function PrivacyES() {
  return (
    <div className="text-[15px] leading-relaxed text-ink flex flex-col gap-4">
      <h1 className="font-display text-3xl tracking-wide mb-1">Privacidad</h1>
      <p className="text-xs text-muted">Última actualización: 2026-06-03</p>

      <h2 className="font-display text-xl tracking-wide mt-4">Qué recogemos</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Correo electrónico</strong> — solo si entras con email vía
          Privy. No recogemos email cuando entras con wallet de auto-custodia.
        </li>
        <li>
          <strong>Dirección de wallet</strong> — tu identificador público
          on-chain con el que juegas.
        </li>
        <li>
          <strong>Datos de juego</strong> — preguntas servidas, respuestas,
          tiempos, puntajes. Sirven para leaderboards y detección de bots.
        </li>
        <li>
          <strong>Analítica</strong> — visitas, país (por IP), tipo de
          dispositivo, fuente de tráfico. Vía PostHog.
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">
        Qué NO recogemos
      </h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          Nombre real, teléfono, documentos de identidad, KYC.
        </li>
        <li>
          Datos de tarjeta o banco (transamos en USDT, no en moneda fiat).
        </li>
        <li>Actividad de navegación fuera de nerdos.fun.</li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">Para qué</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Email</strong> — recordatorios diarios del juego y
          respuestas a soporte.
        </li>
        <li>
          <strong>Wallet</strong> — identificar tus jugadas y enviar premios
          on-chain.
        </li>
        <li>
          <strong>Datos de juego</strong> — leaderboards, anti-trampa, mejorar
          balance del juego.
        </li>
        <li>
          <strong>Analítica</strong> — entender tráfico, corregir UX, planear
          disponibilidad por país.
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">
        Con quién compartimos
      </h2>
      <p>Usamos estos proveedores:</p>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Privy</strong> — autenticación y wallet embebida
        </li>
        <li>
          <strong>Supabase</strong> — base de datos
        </li>
        <li>
          <strong>Vercel</strong> — hosting de la app
        </li>
        <li>
          <strong>SendGrid / Resend</strong> — envío de emails
        </li>
        <li>
          <strong>Cloudflare Turnstile</strong> — verificación anti-bot
        </li>
        <li>
          <strong>PostHog</strong> — analítica de producto
        </li>
        <li>
          <strong>Alchemy / Forno</strong> — proveedores RPC de Celo
        </li>
      </ul>
      <p>
        Tu dirección de wallet y los resultados de tus jugadas son públicos en
        la blockchain de Celo por diseño — cualquiera con acceso on-chain
        puede verlos. También publicamos estadísticas agregadas (no
        identifican individualmente) en{" "}
        <Link href="/stats" className="underline">
          /stats
        </Link>
        .
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">Retención</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Email</strong>: hasta que te des de baja o pidas borrado.
        </li>
        <li>
          <strong>Datos de juego</strong>: indefinido. Lo on-chain es
          inmutable.
        </li>
        <li>
          <strong>Analítica</strong>: retención por defecto de PostHog (~90
          días).
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">Tus derechos</h2>
      <ul className="list-disc pl-5 flex flex-col gap-1">
        <li>
          <strong>Darte de baja</strong> de emails: cada email tiene un link
          de unsubscribe.
        </li>
        <li>
          <strong>Borrar</strong> tu email y registros de analítica: escríbenos.
          Los datos on-chain no se pueden borrar (son inmutables por diseño).
        </li>
        <li>
          <strong>Acceder</strong> a tus datos: escríbenos y te enviamos lo que
          tenemos.
        </li>
      </ul>

      <h2 className="font-display text-xl tracking-wide mt-4">Cookies</h2>
      <p>
        Usamos cookies mínimas para sesión y analítica PostHog. Sin trackers
        de publicidad.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">Menores</h2>
      <p>nerdos.fun no está pensado para menores de 18 años.</p>

      <h2 className="font-display text-xl tracking-wide mt-4">Cambios</h2>
      <p>
        Actualizaremos esta página cuando cambie la política y mostraremos
        cambios materiales en la app.
      </p>

      <h2 className="font-display text-xl tracking-wide mt-4">Contacto</h2>
      <p>
        <a className="underline" href="mailto:hi@sakalabs.io">
          hi@sakalabs.io
        </a>
      </p>
    </div>
  );
}
