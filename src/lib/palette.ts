// Color palettes inspired by the original Freaking Grammar (2018).
// Each round picks one randomly so the split-screen looks fresh every game.

export type Palette = {
  left: string;
  right: string;
  leftHex: string;
  rightHex: string;
};

export const PALETTES: Palette[] = [
  { left: "bg-teal", right: "bg-purple", leftHex: "#68c3a0", rightHex: "#a772b0" },
  { left: "bg-yellow", right: "bg-pink", leftHex: "#f8e45a", rightHex: "#f48b99" },
  { left: "bg-blue", right: "bg-orange", leftHex: "#5b77cc", rightHex: "#fabe49" },
];

export function pickPalette(seed?: number): Palette {
  const i = seed != null ? seed % PALETTES.length : Math.floor(Math.random() * PALETTES.length);
  return PALETTES[i];
}
