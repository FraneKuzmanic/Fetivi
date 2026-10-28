type FewOf<K> = K extends `${infer B}_other` ? `${B}_few` : never;

/**
 * A locale with exactly the source's keys, plus a `_few` form beside every `_other` plural
 * (Croatian has one, few and other).
 */
export type Translation<T> = {
  [K in keyof T]: T[K] extends string ? string : Translation<T[K]>;
} & { [K in FewOf<keyof T & string>]: string };
