// BajaClaw mark: a dune-wave glyph (the CLI's ≈ motif), drawn, not an emoji.
export function Mark({ size = 26, title = "BajaClaw" }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" role="img" aria-label={title}>
      <defs>
        <clipPath id="bc-round"><rect x="1" y="1" width="30" height="30" rx="8" /></clipPath>
      </defs>
      <g clipPath="url(#bc-round)">
        <rect x="1" y="1" width="30" height="30" rx="8" fill="var(--amber)" />
        {/* two stacked dune waves */}
        <path d="M2 21 q6 -6 12 0 t12 0 t12 0" fill="none"
          stroke="oklch(0.99 0.01 70)" strokeWidth="2.2" strokeLinecap="round" opacity="0.95" />
        <path d="M2 26 q6 -6 12 0 t12 0 t12 0" fill="none"
          stroke="var(--teal)" strokeWidth="2.2" strokeLinecap="round" opacity="0.9" />
      </g>
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className="wordmark">
      <Mark />
      <span className="wordmark-text">
        Baja<strong>Claw</strong>
      </span>
    </span>
  );
}
