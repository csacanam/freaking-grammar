"use client";

import { useEnsName } from "wagmi";
import { mainnet } from "viem/chains";

// Shows an ENS name if the address has one (resolved on mainnet), else
// falls back to a generated username. Used in leaderboards and profile
// headers.
//
// MiniPay listing feedback: don't surface wallet addresses for players —
// not even truncated fragments behind a "Player" label. So instead of
// `Player 1a2b…cdef` we derive a friendly pseudonym (AdjectiveNoun###)
// deterministically from the address. Deterministic matters: the same
// player must read as the same name on every device and in every
// leaderboard without any backend storage.
//
// Entropy: 64 adjectives × 64 nouns × 900 numbers ≈ 3.7M combos. At any
// plausible player count the birthday-paradox odds of two rows sharing a
// name in one leaderboard are negligible (~200 players → <0.6%), same
// ballpark as the previous 8-hex-char scheme. ENS still wins when set.

const ADJECTIVES = [
  "Swift", "Brave", "Clever", "Mighty", "Sneaky", "Turbo", "Cosmic", "Lucky",
  "Witty", "Rapid", "Golden", "Shadow", "Electric", "Frozen", "Blazing", "Silent",
  "Nimble", "Bold", "Curious", "Dashing", "Epic", "Fierce", "Gentle", "Happy",
  "Iron", "Jolly", "Keen", "Loyal", "Magic", "Noble", "Prime", "Quick",
  "Royal", "Stellar", "Tricky", "Ultra", "Vivid", "Wild", "Zesty", "Atomic",
  "Bright", "Crafty", "Daring", "Eager", "Funky", "Grand", "Hyper", "Icy",
  "Jazzy", "Kind", "Lively", "Mellow", "Neon", "Odd", "Plucky", "Quirky",
  "Rusty", "Smooth", "Tidy", "Urban", "Vast", "Warm", "Young", "Zen",
];

const NOUNS = [
  "Tiger", "Falcon", "Panda", "Otter", "Fox", "Wolf", "Eagle", "Shark",
  "Mango", "Comet", "Rocket", "Ninja", "Wizard", "Knight", "Pirate", "Robot",
  "Badger", "Cobra", "Dolphin", "Ember", "Fjord", "Gecko", "Hawk", "Ibis",
  "Jaguar", "Koala", "Lemur", "Meteor", "Nomad", "Orca", "Puma", "Quasar",
  "Raven", "Sphinx", "Toucan", "Umbra", "Viper", "Walrus", "Yeti", "Zebra",
  "Anchor", "Bishop", "Cipher", "Drift", "Echo", "Flame", "Glitch", "Halo",
  "Ion", "Joker", "Kite", "Laser", "Mirage", "Nova", "Onyx", "Pixel",
  "Quill", "Rune", "Saber", "Titan", "Unit", "Vortex", "Whale", "Zephyr",
];

// FNV-1a 32-bit — tiny, deterministic, good avalanche for short strings.
function fnv1a(str: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h;
}

export function usernameFor(address: string): string {
  const key = address.toLowerCase();
  const a = fnv1a(key, 0x1234);
  const b = fnv1a(key, 0xbeef);
  const adj = ADJECTIVES[a % ADJECTIVES.length];
  const noun = NOUNS[b % NOUNS.length];
  const num = 100 + ((a ^ b) >>> 8) % 900;
  return `${adj}${noun}${num}`;
}

export function PlayerName({ address }: { address: string }) {
  const { data: ensName } = useEnsName({
    address: address as `0x${string}`,
    chainId: mainnet.id,
  });
  return <span>{ensName ?? usernameFor(address)}</span>;
}
