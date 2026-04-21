// The split-screen used to rotate between three palettes each round for
// novelty, but that made every UI decision (timer bar, overlays, errors)
// harder — each element had to work against three different backgrounds.
// We now commit to ONE canonical palette (teal + purple) as the brand look,
// matching the OG image and pot cards. pickPalette still returns it on any
// seed so callers don't need to change.

export type Palette = {
  left: string;
  right: string;
  leftHex: string;
  rightHex: string;
};

const BRAND: Palette = {
  left: "bg-teal",
  right: "bg-purple",
  leftHex: "#68c3a0",
  rightHex: "#a772b0",
};

export const PALETTES: Palette[] = [BRAND];

export function pickPalette(_seed?: number): Palette {
  void _seed;
  return BRAND;
}
