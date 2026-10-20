import { randomInt } from 'node:crypto';

/** Draws one candidate PIN. Tests pass their own source. */
export type PinSource = () => string;

/** Uniform over 000000–999999. Never Math.random. */
export const randomPin: PinSource = () => String(randomInt(0, 1_000_000)).padStart(6, '0');
