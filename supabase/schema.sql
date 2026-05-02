-- Freaking Grammar — Supabase schema
-- One database serves both EN and ES deploys; rows are scoped by `lang`.

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------- questions
-- Curated bank. `phrase` uses "____" as the blank placeholder.
-- `correct` is what fills the blank, `wrong` is the decoy.
create table if not exists questions (
  id           uuid primary key default gen_random_uuid(),
  lang         text not null check (lang in ('en','es')),
  phrase       text not null,
  correct      text not null,
  wrong        text not null,
  difficulty   smallint not null default 1,         -- 1 easy .. 5 hard
  active       boolean not null default true,
  created_at   timestamptz not null default now()
);
create index if not exists questions_lang_active_idx on questions (lang, active);

-- ---------------------------------------------------------------------- runs
-- One row per game session. Server-controlled timestamps for fair tiebreak.
create table if not exists runs (
  id            uuid primary key default gen_random_uuid(),
  lang          text not null check (lang in ('en','es')),
  game_id       smallint not null,                  -- 1 = EN, 2 = ES (matches contract)
  day_utc       date not null,
  player        text not null,                      -- lower-case 0x address
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  score         integer not null default 0,
  was_free      boolean not null default false,
  paid_tx_hash  text,                               -- on-chain tx if paid
  status        text not null default 'open'        -- open | finished | abandoned
                check (status in ('open','finished','abandoned'))
);
create index if not exists runs_day_score_idx on runs (lang, day_utc, score desc, ended_at asc);
create index if not exists runs_player_idx on runs (player, day_utc);

-- ---------------------------------------------------------- run_questions
-- Each question shown in a run, with timing for anti-cheat + tiebreaker.
create table if not exists run_questions (
  id              uuid primary key default gen_random_uuid(),
  run_id          uuid not null references runs(id) on delete cascade,
  question_id     uuid not null references questions(id),
  q_index         smallint not null,                -- order within the run
  served_at       timestamptz not null default now(),
  answered_at     timestamptz,
  answer_correct  boolean,
  answer_choice   text                              -- 'left' | 'right'
);
create index if not exists run_questions_run_idx on run_questions (run_id, q_index);

-- -------------------------------------------------------------------- pots
-- Mirror of on-chain pot state for fast UI reads + history.
create table if not exists pots (
  lang          text not null check (lang in ('en','es')),
  day_utc       date not null,
  day_number    integer not null,                   -- contract's day counter
  amount_units  numeric(38,0) not null default 0,   -- raw token units
  winner        text,                               -- lower-case address
  winner_score  integer,
  rolled_tx     text,                               -- rollDay tx hash
  closed        boolean not null default false,
  primary key (lang, day_utc)
);
create index if not exists pots_lang_idx on pots (lang, day_utc desc);

-- -------------------------------------------------------------------- wins
-- One row per (winner, day, lang). Materialized from `pots` for the You tab.
create table if not exists wins (
  lang        text not null,
  day_utc     date not null,
  player      text not null,
  amount_units numeric(38,0) not null,
  claimed     boolean not null default false,
  claim_tx    text,
  primary key (lang, day_utc, player)
);
create index if not exists wins_player_idx on wins (player, claimed);

-- ------------------------------------------------ sponsor_campaigns
-- External sponsors (communities, DAOs, individuals) committing a budget of
-- any ERC20 on Celo as a *bonus* on top of the USDT pot. Each day's winner
-- of the games in `games[]` receives `daily_amount_per_game_units` of
-- `token_address`. Carry-over is implicit: days without a winner don't
-- spend budget, so the campaign naturally extends.
create table if not exists sponsor_campaigns (
  id                           uuid primary key default gen_random_uuid(),
  name                         text not null,                        -- "Celo Colombia"
  emoji                        text,                                 -- "🇨🇴" for display
  contact_url                  text,                                 -- optional sponsor link
  token_address                text not null,                        -- ERC20 on Celo, lower-case
  token_symbol                 text not null,
  token_decimals               integer not null,
  daily_amount_per_game_units  numeric(78,0) not null,               -- per game, per day
  total_budget_units           numeric(78,0) not null,
  games                        text[] not null default array['en','es']::text[],
  starts_at_utc                date not null,
  active                       boolean not null default true,
  created_at                   timestamptz not null default now()
);
create index if not exists sponsor_campaigns_active_idx
  on sponsor_campaigns (active, starts_at_utc);

-- ------------------------------------------------ sponsor_payouts
-- Airdrop log — one row per (campaign, lang, day) once the winner has been
-- paid. Used for auditing, /you display of bonus winnings, and summing
-- "spent" to know when a campaign has exhausted its budget.
create table if not exists sponsor_payouts (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references sponsor_campaigns(id) on delete cascade,
  lang             text not null check (lang in ('en','es')),
  day_utc          date not null,
  winner           text not null,
  amount_units     numeric(78,0) not null,
  airdrop_tx_hash  text,
  created_at       timestamptz not null default now(),
  unique (campaign_id, lang, day_utc)
);
create index if not exists sponsor_payouts_winner_idx
  on sponsor_payouts (winner, day_utc desc);

-- ----------------------------------------------- welcome_airdrops
-- One-time CELO airdrop to Privy-provisioned embedded wallets so their
-- first tx (free play) doesn't fail for lack of gas. Only fired for users
-- who actually signed up via Privy (detected client-side by
-- `user.wallet.walletClientType === 'privy'`) — not for self-custody
-- wallets (MetaMask, Rabby, MiniPay, Farcaster) which fund themselves.
-- The email column is optional (we only have it when Privy used email
-- login) and useful for support lookups.
create table if not exists welcome_airdrops (
  address           text primary key,         -- lower-case 0x address
  email             text,
  lang              text check (lang in ('en','es')),  -- ui-lang at signup; drives email template
  email_subscribed  boolean not null default true,     -- unsubscribed users get no daily emails
  linked_at         timestamptz default now(),
  amount_wei        numeric(78,0) not null,
  tx_hash           text,
  created_at        timestamptz not null default now()
);
create index if not exists welcome_airdrops_email_idx on welcome_airdrops (email);
create index if not exists welcome_airdrops_lang_idx on welcome_airdrops (lang);
create index if not exists welcome_airdrops_subscribed_idx
  on welcome_airdrops (email_subscribed) where email_subscribed = true;

-- ----------------------------------------------- gas_refills
-- Audit log of every CELO refill the operator sends to a Privy
-- embedded wallet after the welcome-gas top-up. Used by the gas
-- report cron to enforce a per-user cooldown so we don't double-
-- refill within the same day, and to expose a manual history if a
-- user ever asks "did you guys refill me?".
create table if not exists gas_refills (
  tx_hash      text primary key,
  address      text not null,
  amount_wei   numeric(78,0) not null,
  refilled_at  timestamptz not null default now(),
  trigger      text not null default 'auto-cron'  -- auto-cron | manual | other
);
create index if not exists gas_refills_address_idx
  on gas_refills (address, refilled_at desc);
