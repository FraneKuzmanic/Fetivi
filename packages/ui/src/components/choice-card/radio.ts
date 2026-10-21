const ARROWS: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/** Where an arrow key moves within a radio group of `count` options (wrapping), or null for other keys. */
export function radioMove(key: string, index: number, count: number): number | null {
  const by = ARROWS[key];
  return by === undefined ? null : (index + by + count) % count;
}
