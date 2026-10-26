// A Dalmatian stone house on the quay, drawn like the mascot: navy outline, round joins, flat fills.
const INK = '#1a2c5b';
const STONE = '#fff1df';
const ROOF = '#f7931e';
const SHUTTER = '#2f9fdc';
const SEA = '#afdbf5';
const QUAY = '#c9d2e0';

export function HarbourHouse({ className = 'auth-illustration' }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 360 260"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke={INK}
      strokeWidth="2.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      {/* Sun and a gull */}
      <circle cx="292" cy="52" r="20" fill={STONE} />
      <path d="M58 58 q8 -8 16 0 q8 -8 16 0" />

      {/* Sea with a few wave strokes */}
      <path
        d="M16 206 H344 C358 206 362 220 354 234 C344 252 296 258 180 258 C64 258 16 252 6 234 C-2 220 2 206 16 206 Z"
        fill={SEA}
      />
      <path d="M30 228 q10 -6 20 0 M96 242 q10 -6 20 0 M248 236 q10 -6 20 0 M310 222 q10 -6 20 0" />

      {/* Quay */}
      <path d="M40 206 V186 H300 V206" fill={QUAY} />
      <path d="M90 186 v20 M150 186 v20 M210 186 v20 M260 186 v20" />

      {/* House */}
      <path d="M112 76 V46 H128 V76" fill={STONE} />
      <path d="M92 186 V96 H248 V186 Z" fill={STONE} />
      <path d="M80 98 L170 44 L260 98 Z" fill={ROOF} />
      {/* Stone courses */}
      <path d="M100 118 h18 M140 112 h22 M206 120 h26 M104 164 h16 M216 160 h20 M150 172 h14" />

      {/* Door with a stone arch */}
      <path d="M152 186 V146 a18 18 0 0 1 36 0 V186" fill={SHUTTER} />
      <path d="M170 128 v58" />
      <circle cx="179" cy="164" r="1.8" fill={INK} stroke="none" />

      {/* Windows with open shutters */}
      <rect x="112" y="130" width="22" height="28" fill="#ffffff" />
      <path d="M112 130 l-12 4 v28 l12 -4 Z M134 130 l12 4 v28 l-12 -4 Z" fill={SHUTTER} />
      <rect x="206" y="130" width="22" height="28" fill="#ffffff" />
      <path d="M206 130 l-12 4 v28 l12 -4 Z M228 130 l12 4 v28 l-12 -4 Z" fill={SHUTTER} />

      {/* A pot of herbs by the door */}
      <path d="M200 186 l-3 -14 h16 l-3 14 Z" fill={ROOF} />
      <path d="M205 172 c-6 -10 -2 -16 0 -18 c2 2 6 8 0 18 M205 172 c4 -8 10 -8 12 -8" />

      {/* A small wooden boat on the water */}
      <path d="M232 222 h72 l-10 14 h-52 Z" fill="#ffffff" />
      <path d="M238 229 h60" stroke={SHUTTER} strokeWidth="4" />
      <path d="M268 222 v-30 l22 26 Z" fill="#ffffff" />
    </svg>
  );
}
