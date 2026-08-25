// Shared board identity helpers.
// Colors are stored as medium "base" tones and displayed softened, so every
// board — including ones saved with older punchy colors — reads as a soft pastel.

export const BOARD_PALETTE = [
  "#5B87DA", // blue
  "#57B394", // green
  "#E6B45C", // amber
  "#E88585", // coral
  "#A783DE", // violet
  "#4FC3BC", // teal
  "#E8926A", // peach
];

function hash(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

function toRgb(hex) {
  if (!hex || typeof hex !== "string") return null;
  const c = hex.replace("#", "");
  const n =
    c.length === 3
      ? c
          .split("")
          .map((x) => x + x)
          .join("")
      : c;
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  return [r, g, b].some(Number.isNaN) ? null : { r, g, b };
}

const hx = (x) =>
  Math.max(0, Math.min(255, Math.round(x)))
    .toString(16)
    .padStart(2, "0");

// Mix a color toward white for a gentle pastel.
export function soften(hex, amt = 0.4) {
  const rgb = toRgb(hex);
  if (!rgb) return hex;
  return `#${hx(rgb.r + (255 - rgb.r) * amt)}${hx(rgb.g + (255 - rgb.g) * amt)}${hx(rgb.b + (255 - rgb.b) * amt)}`;
}

// Displayed board color: a softened pastel derived from the stored/base color.
export function getBoardColor(board) {
  const base =
    board?.color || BOARD_PALETTE[hash(board?.id || board?.title) % BOARD_PALETTE.length];
  return soften(base);
}

export function boardInitial(board) {
  return (board?.title?.trim()?.[0] || "B").toUpperCase();
}

export function personInitial(value) {
  return (String(value || "").trim()[0] || "?").toUpperCase();
}

// Pick a legible ink (navy or white) for text on top of `hex`.
export function readableText(hex) {
  const rgb = toRgb(hex);
  if (!rgb) return "#FFFFFF";
  const L = (0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b) / 255;
  return L > 0.6 ? "#0E2E56" : "#FFFFFF";
}
