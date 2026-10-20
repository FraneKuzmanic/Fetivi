import { type ReactNode, useId } from 'react';

// Placeholder Fetivi after .scratch/design/references/mascot.jpg: a local Dalmatian man with an
// orange moustache and beard in a blue-and-white striped shirt. The final artwork replaces this
// one component.

const INK = '#1a2c5b';
const SKIN = '#f0dcc8';
const BEARD = '#f7931e';
const STRIPE = '#2f9fdc';

export function Mascot({ className = 'mascot' }: { className?: string }) {
  const clip = useId();
  return (
    <svg
      className={className}
      viewBox="0 0 120 120"
      aria-hidden="true"
      focusable="false"
      fill="none"
      stroke={INK}
      strokeWidth="2.5"
      strokeLinejoin="round"
      strokeLinecap="round"
    >
      <defs>
        <clipPath id={clip}>
          <path d="M16 118 V94 Q16 72 42 70 H78 Q104 72 104 94 V118 Z" />
        </clipPath>
      </defs>
      <path d="M16 118 V94 Q16 72 42 70 H78 Q104 72 104 94 V118 Z" fill="#ffffff" />
      <g clipPath={`url(#${clip})`} fill={STRIPE} stroke="none">
        {[76, 88, 100, 112].map((y) => (
          <rect key={y} x="10" y={y} width="100" height="6" />
        ))}
      </g>
      <path d="M16 118 V94 Q16 72 42 70 H78 Q104 72 104 94 V118 Z" />
      <ellipse cx="38" cy="52" rx="5.5" ry="7.5" fill={SKIN} />
      <ellipse cx="82" cy="52" rx="5.5" ry="7.5" fill={SKIN} />
      <path
        d="M60 12 C45 12 39 30 39 52 C39 66 47 74 60 74 C73 74 81 66 81 52 C81 30 75 12 60 12 Z"
        fill={SKIN}
      />
      <path d="M52 10 l-2 -4 M58 9 v-4 M64 9 l1 -4 M70 11 l2 -4" />
      <circle cx="53" cy="38" r="1.8" fill={INK} stroke="none" />
      <circle cx="67" cy="38" r="1.8" fill={INK} stroke="none" />
      <path d="M60 36 C55 44 53 50 57 53 C59 55 63 54 63 51" />
      <circle cx="47" cy="56" r="3.5" fill="#f4b8b0" stroke="none" />
      <circle cx="73" cy="56" r="3.5" fill="#f4b8b0" stroke="none" />
      <path d="M44 62 C43 84 51 90 60 90 C69 90 77 84 76 62 Z" fill={BEARD} />
      <path
        d="M60 57 C52 53 40 57 33 68 C44 67 52 66 60 61 C68 66 76 67 87 68 C80 57 68 53 60 57 Z"
        fill={BEARD}
      />
    </svg>
  );
}

/** Fetivi beside a speech line. */
export function MascotSays({ children }: { children: ReactNode }) {
  return (
    <div className="mascot-says">
      <Mascot />
      <p className="speech">{children}</p>
    </div>
  );
}
