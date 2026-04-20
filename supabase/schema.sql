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
