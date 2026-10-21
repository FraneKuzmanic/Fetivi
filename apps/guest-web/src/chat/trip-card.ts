/** The device remembers a skipped trip card per Space; storage may be unavailable. */
export const tripCardKey = (unitSlug: string, closedAt: string) =>
  `fetivi.tripCardSkipped.${unitSlug}.${closedAt}`;

export function tripCardSkipped(key: string): boolean {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}

export function skipTripCard(key: string): void {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // Private mode or blocked storage: the card stays hidden for this page only.
  }
}
