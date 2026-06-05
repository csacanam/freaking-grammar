# nerdos.fun — Origin Manifest for MiniPay Submission

> Required by MiniPay Stage-2 readiness §4 ("Network Transparency"):
> *"provide a full manifest of every URL, subdomain, and origin your app
> calls (JS, CSS, fonts, RPCs, APIs). MiniPay reviews this for
> supply-chain risk."*
>
> This document is generated from the production CSP in `next.config.ts`
> plus the few origins called from server-side code that don't appear
> in the user's browser (and therefore aren't in the CSP). Keep this
> file in sync when you add a new origin — easiest test is to compare
> against the `Content-Security-Policy` response header on
> `https://nerdos.fun`.

## Production app

| Origin | Type | Purpose |
|---|---|---|
| `https://nerdos.fun` | self | App hosting (Vercel). Serves HTML, JS, CSS, images, API routes. |
| `https://privy.nerdos.fun` | self (CNAME) | Privy HttpOnly-cookies custom domain. CNAME pointing at Privy infra; used by Privy SDK when HttpOnly cookies are enabled in the Privy dashboard. |

## Third-party — loaded in the browser

### Authentication / wallet

| Origin | Used as | Why |
|---|---|---|
| `https://auth.privy.io` | iframe + fetch | Privy login UX (email code entry) + auth API |
| `https://*.rpc.privy.systems` | fetch | Privy-managed RPC for the embedded wallet sign flow |
| `https://verify.walletconnect.com` | iframe | WalletConnect wallet-verification flow |
| `https://verify.walletconnect.org` | iframe | Same, alternate domain |
| `https://explorer-api.walletconnect.com` | fetch | WalletConnect explorer lookups (wallet list) |
| `https://pulse.walletconnect.org` | fetch | WalletConnect telemetry |
| `https://api.web3modal.org` | fetch | Reown / Web3Modal config |
| `wss://relay.walletconnect.com` | websocket | WalletConnect pairing relay |
| `wss://relay.walletconnect.org` | websocket | Same, alternate domain |
| `wss://www.walletlink.org` | websocket | Coinbase Wallet (WalletLink) connection |

### Anti-bot

| Origin | Used as | Why |
|---|---|---|
| `https://challenges.cloudflare.com` | script + iframe | Cloudflare Turnstile invisible captcha on the welcome-gas onboarding flow |

### Analytics

| Origin | Used as | Why |
|---|---|---|
| `https://us.i.posthog.com` | fetch | PostHog event ingestion |
| `https://us.posthog.com` | fetch | PostHog management API (only hit from `/stats` server-render, not from the browser) |
| `https://us-assets.i.posthog.com` | script + fetch | PostHog session-recording, autocapture, surveys, web-vitals — lazy-loaded modules |

### Blockchain / RPC

| Origin | Used as | Why |
|---|---|---|
| `https://*.g.alchemy.com` | fetch | Alchemy RPC (Celo mainnet primary + Ethereum mainnet for ENS resolution). Subdomain wildcard covers `celo-mainnet.g.alchemy.com`, `eth-mainnet.g.alchemy.com`, etc. |
| `https://forno.celo.org` | fetch | Public Celo RPC. Used as Alchemy fallback (see `lib/chain.ts` → `CELO_TRANSPORT`). |
| `https://ethereum-rpc.publicnode.com` | fetch | Public Ethereum mainnet RPC for ENS resolution when Alchemy isn't reachable. |
| `https://celo.blockscout.com` | fetch | Celo block explorer API — used for occasional on-chain lookups from the client (e.g. recent-tx panels). |

### MiniPay-specific deeplinks (navigated to, not fetched)

| URL | When |
|---|---|
| `https://link.minipay.xyz/add_cash?tokens=USDT` | Single CTA in `NeedFundsModal` MiniPay branch when the user is short on USDT. |

## Third-party — server-side only

These origins are called from API routes / cron jobs and never reach the
user's browser. Included for full supply-chain transparency.

| Origin | Used by | Why |
|---|---|---|
| `https://*.supabase.co` | every API route + cron | Database (Postgres + auto-REST via PostgREST). |
| `https://api.sendgrid.com` | `/api/cron/daily-email-*` | Transactional email delivery (primary). |
| `https://api.resend.com` | same crons (fallback) | Transactional email delivery (used when `SENDGRID_API_KEY` is unset). |
| `https://api.telegram.org` | every cron with alerts | Operator alerts (treasury low, captcha rejections, etc.). |
| `https://auth.privy.io` | `scripts/find-csp-regression-victims.mjs` + `welcome-gas` lookups | Privy admin API for user enumeration. |
| `https://challenges.cloudflare.com/turnstile/v0/siteverify` | `/api/welcome-gas` | Server-side Turnstile token verification. |
| `https://pagespeed.web.dev` (optional) | manual | Where you run PageSpeed audits. Not called by app code. |

## How to regenerate

If you add a new external origin in code:

1. Update the matching directive in `next.config.ts`'s `csp` array
2. Update this file under the matching section
3. (Optional) hit prod with `curl -sI https://nerdos.fun | grep -i content-security-policy` and diff against §1 above to confirm
