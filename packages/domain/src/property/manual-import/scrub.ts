// The prompt keeps secrets out of block text; this makes it certain. The model may still echo a
// value it extracted, and a string match on its own extracted values cannot miss that.

const MIN_SECRET_CHARS = 4;
const PHONE_SEPARATORS = '[\\s\\-/().]*';

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** A phone number also matches with other spacing, dashes, slashes, dots or brackets. */
function patternFor(secret: string): RegExp {
  const compact = secret.replace(/[\s\-/().]/g, '');
  if (/^\+?\d{6,}$/.test(compact)) {
    return new RegExp([...compact].map(escapeRegExp).join(PHONE_SEPARATORS), 'g');
  }
  return new RegExp(escapeRegExp(secret), 'g');
}

/** Replaces every extracted secret value found in a block's title or body with ***. */
export function scrubSecrets<B extends { title: string; body: string }>(
  blocks: readonly B[],
  secrets: readonly (string | null | undefined)[],
): (B & { scrubbed: boolean })[] {
  const patterns = secrets
    .map((s) => s?.trim())
    .filter((s): s is string => !!s && s.replace(/\s/g, '').length >= MIN_SECRET_CHARS)
    .map(patternFor);

  return blocks.map((block) => {
    let { title, body } = block;
    for (const pattern of patterns) {
      title = title.replace(pattern, '***');
      body = body.replace(pattern, '***');
    }
    return { ...block, title, body, scrubbed: title !== block.title || body !== block.body };
  });
}
