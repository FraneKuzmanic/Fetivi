import type { SkyCode, WarningLevel, WeatherSourceName } from '@fetivi/domain/weather-vocabulary';
import { SunDim, Warning, Waves } from '@phosphor-icons/react';
import { useId } from 'react';
import type { WeatherCardPayload } from '../../payloads';
import { SKY_ICONS } from './sky';

/** Every visible string of the weather card; the app translates them. */
export interface WeatherLabels {
  heading: string;
  /** "Friday 16 July", given a civil date. */
  day: (date: string) => string;
  today: string;
  tomorrow: string;
  tempRange: (minC: number, maxC: number) => string;
  rain: (mm: number) => string;
  wind: (ms: number) => string;
  sea: (tempC: number, station: string) => string;
  /** Today's UV maximum with its WHO band: "UV up to 7 (high) at Split". */
  uv: (value: number, station: string) => string;
  warningLevel: (level: WarningLevel) => string;
  /** The warning's span, in the property's zone. */
  warningTime: (onset: string, expires: string, timezone: string) => string;
  warningsUnknown: string;
  /** Only for screen readers: an empty list shows nothing. */
  noWarnings: string;
  forecastUnavailable: string;
  sources: string;
  /** A credit link's text: "MET Norway (forecast, CC BY 4.0)". */
  credit: (source: WeatherSourceName) => string;
  skyName: (sky: SkyCode) => string;
}

type WeatherDay = NonNullable<WeatherCardPayload['days']>[number];

/** The civil date at `zone` for `now`, and the day after. */
function todayAndTomorrow(now: Date, zone: string): [string, string] {
  const civil = (d: Date) =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(d);
  const today = civil(now);
  const next = new Date(`${today}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  return [today, next.toISOString().slice(0, 10)];
}

/**
 * get_weather's card: official warnings first, then up to three days, the sea and UV, and the
 * credits both licences ask for. A null part says "could not check"; it never reads as "none".
 */
export function WeatherCard({
  report,
  labels,
  now = new Date(),
}: {
  report: WeatherCardPayload;
  labels: WeatherLabels;
  /** "Today" and "tomorrow" are relative to it, so a stored card stays right. */
  now?: Date;
}) {
  const headingId = useId();
  const [today, tomorrow] = todayAndTomorrow(now, report.timezone);
  const dayLabel = (date: string) =>
    date === today ? labels.today : date === tomorrow ? labels.tomorrow : labels.day(date);
  const { warnings, days, sea, uv } = report;

  return (
    <section className="fv-weather" aria-labelledby={headingId}>
      <h3 id={headingId} className="fv-weather-heading">
        {labels.heading}
      </h3>

      {warnings === null ? (
        <p className="fv-weather-muted">{labels.warningsUnknown}</p>
      ) : warnings.length === 0 ? (
        <p className="fv-visually-hidden">{labels.noWarnings}</p>
      ) : (
        <ul className="fv-weather-warnings">
          {warnings.map((w) => (
            <li
              key={`${w.event}|${w.area}|${w.onset}`}
              className="fv-weather-warning"
              data-level={w.level}
            >
              <p className="fv-weather-warning-title">
                <Warning size={20} aria-hidden="true" />
                <span className="fv-weather-level">{labels.warningLevel(w.level)}</span>
                <span>{w.event}</span>
              </p>
              <p className="fv-weather-warning-meta">
                {w.area} · {labels.warningTime(w.onset, w.expires, report.timezone)}
              </p>
              {w.description && <p className="fv-weather-warning-text">{w.description}</p>}
            </li>
          ))}
        </ul>
      )}

      {days === null || days.length === 0 ? (
        <p className="fv-weather-muted">{labels.forecastUnavailable}</p>
      ) : (
        <ul className="fv-weather-days">
          {days.map((day) => (
            <Day key={day.date} day={day} label={dayLabel(day.date)} labels={labels} />
          ))}
        </ul>
      )}

      {(sea || uv) && (
        <ul className="fv-weather-extras">
          {sea && (
            <li>
              <Waves size={20} aria-hidden="true" />
              {labels.sea(sea.temperatureC, sea.station)}
            </li>
          )}
          {uv && (
            <li>
              <SunDim size={20} aria-hidden="true" />
              {labels.uv(uv.maxToday, uv.station)}
            </li>
          )}
        </ul>
      )}

      <p className="fv-weather-credits">
        <span>{labels.sources}</span>
        {report.credits.map((c) => (
          <a key={c.source} href={c.url} target="_blank" rel="noreferrer">
            {labels.credit(c.source)}
          </a>
        ))}
      </p>
    </section>
  );
}

function Day({ day, label, labels }: { day: WeatherDay; label: string; labels: WeatherLabels }) {
  const SkyIcon = SKY_ICONS[day.sky];
  return (
    <li className="fv-weather-day">
      <p className="fv-weather-day-name">{label}</p>
      <SkyIcon size={32} aria-hidden="true" />
      <p className="fv-weather-sky">{labels.skyName(day.sky)}</p>
      <p className="fv-weather-temp">{labels.tempRange(day.tempMinC, day.tempMaxC)}</p>
      {day.precipitationMm > 0 && (
        <p className="fv-weather-detail">{labels.rain(day.precipitationMm)}</p>
      )}
      <p className="fv-weather-detail">{labels.wind(day.windMaxMs)}</p>
    </li>
  );
}
