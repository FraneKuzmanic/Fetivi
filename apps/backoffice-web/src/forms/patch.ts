/** The PATCH body of one section: just its fields, with null kept (null clears, or inherits). */
export function sectionBody<T extends object, K extends keyof T>(
  draft: T,
  keys: readonly K[],
): Pick<T, K> {
  const body = {} as Pick<T, K>;
  for (const key of keys) body[key] = draft[key];
  return body;
}

/** A field of a unit that currently overrides the property, handed back to it. */
export function inheritField<T extends object, K extends keyof T>(draft: T, key: K): T {
  return { ...draft, [key]: null };
}
