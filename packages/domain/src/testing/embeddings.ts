// Test-only embedders, so no test reaches Voyage. The fake understands words, not meaning:
// integration tests check wiring, the recorded fixture set checks meaning.
import {
  type Embedder,
  type EmbeddingInput,
  EmbeddingUnavailableError,
} from '../embeddings/voyage';

const FAKE_MODEL = 'fake-1';
const FAKE_DIMENSIONS = 64;

function hash(word: string): number {
  let h = 0;
  for (const ch of word) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  return h;
}

/** A deterministic bag-of-words vector: each word of 3+ letters adds 1 at a slot of its first four letters. */
function fakeVector(text: string): number[] {
  const v = new Array<number>(FAKE_DIMENSIONS).fill(0);
  const words = text
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length >= 3);
  for (const w of words) {
    const i = hash(w.slice(0, 4)) % FAKE_DIMENSIONS;
    v[i] = (v[i] ?? 0) + 1;
  }
  const norm = Math.hypot(...v);
  return norm === 0 ? v : v.map((x) => x / norm);
}

/** An embedder that records its calls and returns word-bag vectors; tokens = words. */
export function fakeEmbedder(): Embedder & {
  readonly calls: { texts: string[]; input: EmbeddingInput }[];
} {
  const calls: { texts: string[]; input: EmbeddingInput }[] = [];
  return {
    model: FAKE_MODEL,
    calls,
    async embed(texts, input) {
      calls.push({ texts, input });
      const tokens = texts.reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0);
      return { vectors: texts.map(fakeVector), tokens };
    },
  };
}

/** An embedder without a key: every call is unavailable. */
export function unavailableEmbedder(): Embedder {
  return {
    model: FAKE_MODEL,
    async embed() {
      throw new EmbeddingUnavailableError('no key');
    },
  };
}
