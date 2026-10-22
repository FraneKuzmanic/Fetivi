import { eq } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { destinations } from '../../db/schema/catalog';
import type { JobQueue } from '../../jobs/queue';
import { fromLocalDateTime } from '../../time';
import {
  createCatalogRecord,
  markVerified,
  type NewCatalogRecord,
  replaceOpeningHours,
  replacePlaceImages,
  replaceSeasons,
  type SeasonInput,
} from '../store';

const ZONE = 'Europe/Zagreb';
const TOURIST_BOARD = 'https://visittrogir.hr/';
const SPRING_TO_AUTUMN: SeasonInput = { fromMonth: 4, fromDay: 1, toMonth: 10, toDay: 31 };
const point = (lat: number, lng: number) => ({ x: lng, y: lat });

/**
 * Development fixture: Trogir with a few records. Records are stamped verified now; they are dev
 * data, not checked facts. Runs through the normal write path, so each record's translation job
 * is enqueued. Skips when a destination named Trogir exists.
 */
export async function seedTrogir(
  db: Db,
  queue: JobQueue,
  now: Date,
): Promise<{ destinationId: string; created: boolean }> {
  const [existing] = await db
    .select({ id: destinations.id })
    .from(destinations)
    .where(eq(destinations.name, 'Trogir'));
  if (existing) return { destinationId: existing.id, created: false };

  const [destination] = await db
    .insert(destinations)
    .values({ name: 'Trogir', centre: point(43.5169, 16.2513), radiusM: 15_000, timezone: ZONE })
    .returning();
  if (!destination) throw new Error('destination insert returned nothing');
  const destinationId = destination.id;

  const create = async (values: Omit<NewCatalogRecord, 'destinationId'>) => {
    const record = await createCatalogRecord(db, queue, { destinationId, ...values }, now);
    await markVerified(db, record.id, null, now);
    return record;
  };
  const textSources = (url: string) => ({ title: url, description: url });

  const kamerlengo = await create({
    kind: 'place',
    placeCategory: 'sight',
    title: 'Kamerlengo Fortress',
    description:
      'A 15th-century Venetian fortress at the western tip of the old town. Its walls and tower look out over the channel and the Čiovo bridge.\n\nIn summer the courtyard hosts open-air concerts and film nights.',
    location: point(43.5161, 16.2475),
    fieldSources: textSources(TOURIST_BOARD),
  });
  await replaceSeasons(db, kamerlengo.id, [SPRING_TO_AUTUMN], now);
  await replaceOpeningHours(
    db,
    kamerlengo.id,
    [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({
      weekday,
      opens: '09:00',
      closes: '21:00',
      validFrom: '2027-04-01',
      validTo: '2027-10-31',
    })),
    now,
  );
  await replacePlaceImages(
    db,
    kamerlengo.id,
    [
      {
        url: 'https://upload.wikimedia.org/wikipedia/commons/8/89/Fortress_Kamerlengo_14.jpg',
        source: 'wikimedia_commons',
        licence: 'CC BY-SA 4.0',
        attribution: 'Krzysztof Bergier',
        sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Fortress_Kamerlengo_14.jpg',
      },
    ],
    now,
  );

  await create({
    kind: 'place',
    placeCategory: 'sight',
    title: 'Cathedral of St Lawrence',
    description:
      "Trogir's Romanesque-Gothic cathedral on the main square. Its west portal, carved by Master Radovan in 1240, is one of the finest in Croatia.",
    location: point(43.5172, 16.2512),
    rainyDay: true,
    fieldSources: textSources(TOURIST_BOARD),
  });

  const copacabana = await create({
    kind: 'place',
    placeCategory: 'beach',
    title: 'Copacabana beach',
    description:
      'The long pebble beach of Okrug Gornji on Čiovo, about 4 km from the old town. Shallow water, bars and water sports along the shore.',
    location: point(43.4936, 16.2669),
    fieldSources: textSources(TOURIST_BOARD),
  });
  await replaceSeasons(
    db,
    copacabana.id,
    [{ fromMonth: 5, fromDay: 1, toMonth: 9, toDay: 30 }],
    now,
  );

  await create({
    kind: 'place',
    placeCategory: 'nature',
    title: 'Pantan nature reserve',
    description:
      'A protected wetland east of Trogir where the Pantan spring meets the sea. A short walking trail passes reeds, an old mill and a small lagoon.',
    location: point(43.5196, 16.2789),
    fieldSources: textSources(TOURIST_BOARD),
  });

  await create({
    kind: 'event',
    title: 'Trogir Summer of Culture',
    description:
      'Trogirsko kulturno ljeto: the summer festival of classical music, klapa singing and theatre in the old town, many evenings in Kamerlengo Fortress.',
    startsAt: fromLocalDateTime('2027-07-01T20:00', ZONE),
    endsAt: fromLocalDateTime('2027-08-31T23:00', ZONE),
    venueName: 'Kamerlengo Fortress',
    location: point(43.5161, 16.2475),
    interests: ['sights'],
    fieldSources: textSources(TOURIST_BOARD),
  });

  await create({
    kind: 'transport_note',
    transportMode: 'bus',
    title: 'Split–Trogir city bus 37',
    description:
      'City bus line 37 runs between Split and Trogir, stopping near the airport. Buy the ticket from the driver or at a kiosk.',
    links: [{ label: 'Promet Split timetables', url: 'https://www.promet-split.hr/' }],
    fieldSources: textSources('https://www.promet-split.hr/'),
  });

  const krka = await create({
    kind: 'day_trip',
    title: 'Krka National Park',
    description:
      'Waterfalls and wooden walkways along the Krka river. The Skradinski buk falls are the best-known stop; boats run between the main sights.',
    travelMinutes: 60,
    location: point(43.8047, 15.9644),
    websiteUrl: 'https://www.np-krka.hr/',
    fieldSources: textSources('https://www.np-krka.hr/'),
  });
  await replaceSeasons(db, krka.id, [SPRING_TO_AUTUMN], now);

  return { destinationId, created: true };
}
