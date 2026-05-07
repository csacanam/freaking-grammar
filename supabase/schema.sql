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

-- ----------------------------------------------- bot_wallets
-- Persistent blacklist used by roll-day when picking the daily winner.
-- Two sources of entries:
--   - reason='manual'    : seeded or added by ops (e.g., the original
--                          sybil cluster we identified by hand)
--   - reason='heuristic' : auto-inserted the first time checkBotPlayer
--                          sees a wallet match (correctRate≥99% AND
--                          p50<2400ms over ≥30 timed answers). Once a
--                          wallet lands here, future settlements skip
--                          straight on the blacklist short-circuit
--                          without recomputing stats.
-- Removing a row un-flags the wallet. False positives are recoverable.
create table if not exists bot_wallets (
  player        text primary key,                       -- lower-case 0x
  flagged_at    timestamptz not null default now(),
  reason        text not null check (reason in ('manual','heuristic')),
  correct_rate  numeric,                                -- snapshot at flag time
  p50_ms        integer,                                -- snapshot at flag time
  sample_size   integer,                                -- snapshot at flag time
  notes         text
);

-- Seed the six known sybils (one operator, identified manually). idempotent.
insert into bot_wallets (player, reason, notes) values
  ('0x247116c752420ec7fe870d1549a1c2e8d44675c6', 'manual', 'master, funded the rest'),
  ('0x1d7d4da72a32b0ab37b92c773c15412381c7203a', 'manual', '4-day winner before detection'),
  ('0x351d9ac846d3a4e71c2103b91ed7aca67d85be5e', 'manual', 'sibling sybil'),
  ('0xf6826a75a9a9fb41f14732e5ca03df402d2e52ea', 'manual', 'sibling sybil'),
  ('0xdead181ffb8e104ec9347dbf2b8f5884e1ba5f3b', 'manual', 'vanity address sibling'),
  ('0xa41836014a58f004ee0746c7c66305fdcc252cbd', 'manual', 'sibling sybil')
on conflict (player) do nothing;

-- ----------------------------------------------- multi-game (Math)
-- Adding Freaking Math (gameId=3) under nerdos.fun. Grammar already
-- splits per-language with gameId=1 (EN) / gameId=2 (ES); Math is
-- single-pot with no language split. The schema needs to (a) tell
-- "which game" rows belong to and (b) handle null `lang` for games
-- without languages.
--
-- Strategy: `game_id` is the canonical discriminator for primary keys
-- and unique constraints (always non-null, scales to N games trivially
-- as we add more). `game` text is a human-readable shortcut. `lang`
-- becomes truly optional metadata, only meaningful for Grammar's
-- EN/ES split.
--
--   Game ID  Game     Lang
--   1        grammar  en
--   2        grammar  es
--   3        math     null
--   4+       (future) (free)
--
-- Existing Grammar rows: game='grammar', game_id=1 or 2, lang stays.
-- Math rows: game='math', game_id=3, lang=null.

-- Add `game` text shortcut + new game_id columns where missing.
alter table runs            add column if not exists game text not null default 'grammar' check (game in ('grammar','math'));
alter table pots            add column if not exists game text not null default 'grammar' check (game in ('grammar','math'));
alter table wins            add column if not exists game text not null default 'grammar' check (game in ('grammar','math'));
alter table sponsor_payouts add column if not exists game text not null default 'grammar' check (game in ('grammar','math'));

alter table wins            add column if not exists game_id smallint;
alter table sponsor_payouts add column if not exists game_id smallint;

-- Backfill new game_id from existing lang for Grammar wins/payouts.
update wins
  set game_id = case when lang = 'en' then 1 when lang = 'es' then 2 end
  where game_id is null;
update sponsor_payouts
  set game_id = case when lang = 'en' then 1 when lang = 'es' then 2 end
  where game_id is null;

-- Tighten game_id to NOT NULL once backfill is done.
alter table wins            alter column game_id set not null;
alter table sponsor_payouts alter column game_id set not null;

-- Move PK / unique off `lang` (which can't be null while a PK column)
-- onto `game_id` (always set, scales infinitely).
alter table wins drop constraint if exists wins_pkey;
alter table wins add primary key (game_id, day_utc, player);
alter table sponsor_payouts drop constraint if exists sponsor_payouts_campaign_id_lang_day_utc_key;
alter table sponsor_payouts add constraint sponsor_payouts_campaign_id_game_id_day_utc_key
  unique (campaign_id, game_id, day_utc);

-- Now `lang` is free to be null for non-language games.
alter table runs            alter column lang drop not null;
alter table pots            alter column lang drop not null;
alter table wins            alter column lang drop not null;
alter table sponsor_payouts alter column lang drop not null;

-- Replace the original CHECK constraints (the auto-named ones blocked
-- null) with permissive versions that still enforce the en/es enum
-- when lang is set.
alter table runs            drop constraint if exists runs_lang_check;
alter table runs            add constraint runs_lang_check check (lang is null or lang in ('en','es'));
alter table pots            drop constraint if exists pots_lang_check;
alter table pots            add constraint pots_lang_check check (lang is null or lang in ('en','es'));
alter table wins            drop constraint if exists wins_lang_check;
alter table wins            add constraint wins_lang_check check (lang is null or lang in ('en','es'));
alter table sponsor_payouts drop constraint if exists sponsor_payouts_lang_check;
alter table sponsor_payouts add constraint sponsor_payouts_lang_check check (lang is null or lang in ('en','es'));

-- run_questions.question_id references the curated grammar bank, but
-- Math equations are generated dynamically per round — there's no row
-- in `questions` to reference. Allow null and add the math equation
-- payload alongside, so analytics can still group by operation type
-- (which math operations have the highest fail rate, etc.) without
-- forcing math into a synthetic questions table.
alter table run_questions alter column question_id drop not null;
alter table run_questions add column if not exists math_left   integer;
alter table run_questions add column if not exists math_right  integer;
alter table run_questions add column if not exists math_op     text check (math_op in ('+','-','x','/'));
alter table run_questions add column if not exists math_shown  integer;  -- the result the player saw
alter table run_questions add column if not exists math_truth  boolean;  -- whether the shown result is correct

-- ------------------------------------------------------- grants
-- External funding (Celo Foundation, ecosystem grants, hackathon prizes,
-- etc.) tracked separately from `runs.was_free=false` revenue. The point
-- is honest sustainability accounting: the public /api/stats feed should
-- show "we earned $X from players AND received $Y in grants" so external
-- dashboards (sakalabs.io) and onlookers can judge runway accurately
-- instead of conflating subsidies with organic revenue.
--
-- Filled manually via Supabase SQL editor — grants land 1-3x/month, not
-- worth building an admin UI. Insert example:
--   insert into grants (source, amount_units, token_symbol, received_at, note)
--   values ('Celo Foundation', 250000000, 'USDT', '2026-05-01', 'May ecosystem grant');
create table if not exists grants (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,                       -- 'Celo Foundation', 'Optimism RPGF', etc.
  amount_units  numeric not null check (amount_units > 0),  -- raw on-chain units (USDT = 6 decimals)
  token_symbol  text not null default 'USDT',        -- which token the grant came in
  received_at   date not null,                       -- when the grant landed (UTC)
  tx_hash       text,                                -- on-chain receipt, if applicable
  note          text,                                -- one-liner about the grant context
  created_at    timestamptz not null default now()
);

create index if not exists grants_received_at_idx on grants (received_at desc);
