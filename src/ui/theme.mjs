// BajaClaw visual identity - deliberately distinct from OpenClaw's CLI look.
// Zero dependencies: raw ANSI. Honors NO_COLOR and non-TTY.

const enabled =
  process.stdout.isTTY && !process.env.NO_COLOR && process.env.TERM !== "dumb";

const sgr = (open, close) => (s) =>
  enabled ? `\x1b[${open}m${s}\x1b[${close}m` : String(s);

// Palette: warm amber + teal/sand. OpenClaw leans lobster-red; we go desert/baja.
// 256-color helpers (xterm-256 for broad terminal portability)
const fg = (n) => (s) => (enabled ? `\x1b[38;5;${n}m${s}\x1b[39m` : String(s));

export const color = {
  amber: fg(214), // primary
  sand: fg(180),
  teal: fg(43), // secondary / success accents
  sea: fg(38),
  dim: fg(245),
  red: fg(203),
  yellow: fg(221),
  bold: sgr(1, 22),
};

// Status glyphs - distinct set (OpenClaw uses ✓/✗/•; we use these).
export const glyph = {
  ok: color.teal("◇"),
  run: color.amber("◆"),
  warn: color.yellow("◈"),
  err: color.red("◉"),
  info: color.sea("›"),
  bullet: color.sand("▪"),
  arrow: color.amber("→"),
};

// Wordmark - a dune/wave motif, not OpenClaw's lobster banner.
export function wordmark() {
  const a = color.amber;
  const t = color.teal;
  const d = color.dim;
  return [
    a("  ┌╶╶╶╮  ") + t("            "),
    a("  ╿ BAJA") + color.bold(color.sand("CLAW")) + d("  ≈≈≈"),
    d("  the all-in-one personal agent"),
  ].join("\n");
}

// Compact one-line brand for sub-commands.
export function brandline(sub = "") {
  const tag = sub ? color.dim(" · " + sub) : "";
  return color.amber(color.bold("bajaclaw")) + color.teal("≈") + tag;
}

// Rounded box with a left amber rule - distinct from OpenClaw's full borders.
export function panel(title, lines) {
  const out = [];
  const bar = color.amber("▌");
  if (title) out.push(bar + " " + color.bold(color.sand(title)));
  for (const ln of lines) out.push(bar + " " + ln);
  return out.join("\n");
}

// Minimal spinner (braille is overused; use a wave cycle).
const FRAMES = ["≈  ", "≈≈ ", "≈≈≈", " ≈≈", "  ≈", "   "];
export function spinner(label) {
  let i = 0;
  let timer = null;
  const tick = () => {
    if (!enabled) return;
    const f = color.teal(FRAMES[i++ % FRAMES.length]);
    process.stdout.write(`\r${f} ${color.dim(label)} `);
  };
  return {
    start() {
      if (!enabled) {
        process.stdout.write(`${glyph.run} ${label}\n`);
        return this;
      }
      timer = setInterval(tick, 110);
      tick();
      return this;
    },
    stop(finalGlyph = glyph.ok, finalLabel = label) {
      if (timer) clearInterval(timer);
      if (enabled) process.stdout.write("\r\x1b[2K");
      process.stdout.write(`${finalGlyph} ${finalLabel}\n`);
    },
  };
}
