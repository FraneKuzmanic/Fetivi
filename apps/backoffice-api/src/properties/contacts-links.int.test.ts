import {
  type BlockText,
  createJobQueue,
  GUEST_LANGUAGES,
  type GuestLanguage,
  infoBlocks,
  type ModelResult,
  runTranslation,
  type TranslationModel,
} from '@fetivi/domain';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestApp, loginAs, post, signUpVerifiedHost, type TestApp } from '../testing';

// Ticket 52: links in a Contacts and emergency block gave a 400 and a failed translation.

let t: TestApp;
let cookie: string;
let unitId: string;

beforeAll(async () => {
  t = await createTestApp();
  await signUpVerifiedHost(t, 'links@example.test');
  cookie = await loginAs(t, 'links@example.test');
  const p = await post(t.app, '/api/host/properties', { name: 'Villa' }, cookie);
  const u = await post(t.app, `/api/host/properties/${p.json().id}/units`, { name: 'A1' }, cookie);
  unitId = u.json().id;
});

afterAll(async () => {
  await t?.close();
});

/** Each link form a host can reasonably type, with a translation a model plausibly returns. */
const FORMS: { name: string; body: string; translated: string }[] = [
  {
    name: 'a plain URL ending a sentence',
    body: 'Hitna pomoć: https://www.hzhm.hr.',
    translated: 'Emergency: https://www.hzhm.hr.',
  },
  {
    name: 'a plain URL the translation moved away from the full stop',
    body: 'Rezervirajte na https://vila.example.hr.',
    translated: 'Foglaljon a https://vila.example.hr oldalon.',
  },
  {
    name: 'a plain URL the model turned into a link',
    body: 'Ljekarna: https://ljekarna.hr',
    translated: 'Pharmacy: [https://ljekarna.hr](https://ljekarna.hr)',
  },
  {
    name: 'a Markdown link',
    body: 'Dom zdravlja: [karta](https://maps.example.com/dz)',
    translated: 'Health centre: [map](https://maps.example.com/dz)',
  },
  {
    name: 'a tel: link',
    body: '[Nazovite nas](tel:+385911234567)',
    translated: '[Call us](tel:+385911234567)',
  },
  {
    name: 'a mailto: link',
    body: '[Pišite nam](mailto:domacin@example.hr)',
    translated: '[Write to us](mailto:domacin@example.hr)',
  },
  {
    name: 'angle-bracket autolinks',
    body: 'Web: <https://vila.example.hr>, e-mail: <mailto:domacin@example.hr>',
    translated: 'Web: <https://vila.example.hr>, email: <mailto:domacin@example.hr>',
  },
  {
    name: 'several links in one block',
    body: [
      '- Hitna: [194](tel:194)',
      '- Ljekarna: https://ljekarna.hr, otvoreno 0-24.',
      '- Domaćin: [e-mail](mailto:domacin@example.hr) ili [WhatsApp](https://wa.me/385911234567)',
    ].join('\n'),
    translated: [
      '- Emergency: [194](tel:194)',
      '- Pharmacy: https://ljekarna.hr, open 24/7.',
      '- Host: [email](mailto:domacin@example.hr) or [WhatsApp](https://wa.me/385911234567)',
    ].join('\n'),
  },
];

/** A model that detects Croatian, echoes the source for it and returns `translated` for the rest. */
function modelReturning(source: BlockText, translated: BlockText): TranslationModel {
  const translations = Object.fromEntries(
    GUEST_LANGUAGES.map((l) => [l, l === 'hr' ? source : translated]),
  ) as Record<GuestLanguage, BlockText>;
  return {
    translate: async (): Promise<ModelResult> => ({
      ok: true,
      output: { source_language: 'hr', translations },
    }),
  };
}

describe('links in a Contacts and emergency block', () => {
  for (const form of FORMS) {
    it(`saves and translates ${form.name}`, async () => {
      const r = await post(
        t.app,
        `/api/host/units/${unitId}/blocks`,
        { category: 'contacts_emergency', title: 'Kontakti', body: form.body },
        cookie,
      );
      expect(r.statusCode).toBe(201);
      const block = r.json().block as { id: string; revision: number };
      const [stored] = await t.db.select().from(infoBlocks).where(eq(infoBlocks.id, block.id));
      expect(stored?.body).toBe(form.body);

      const source = { title: 'Kontakti', body: form.body };
      const result = await runTranslation(
        {
          db: t.db,
          queue: createJobQueue(t.boss),
          now: t.clock.now,
          model: modelReturning(source, { title: 'Contacts', body: form.translated }),
        },
        { blockId: block.id, revision: block.revision },
      );
      expect(result).toBe('published');
    });
  }
});
