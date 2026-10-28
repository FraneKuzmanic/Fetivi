import {
  CATALOG_LIMITS,
  type CatalogKind,
  IMAGE_SOURCES,
  SOURCE_FIELDS,
} from '@fetivi/domain/catalog-vocabulary';
import { LIMITS } from '@fetivi/domain/vocabulary';
import { Plus, Trash } from '@phosphor-icons/react';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { CatalogLink, FieldSources, OpeningHours, PlaceImage, Season } from '../../api';
import { DateField, DateTimeField, SelectField, TextField, TimeField } from '../../forms/fields';
import { i18next, localeOf } from '../../i18n';
import { currentLabels, useLabels } from '../../i18n/useLabels';

// Controlled list editors for the record page. Each one edits a whole list; its Section saves it
// with one PUT (or, for links and sources, the record PATCH).

const replaceAt = <T,>(list: readonly T[], i: number, item: T) =>
  list.map((x, j) => (j === i ? item : x));
const without = <T,>(list: readonly T[], i: number) => list.filter((_, j) => j !== i);

function RemoveButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="icon-button" aria-label={label} onClick={onClick}>
      <Trash aria-hidden="true" />
    </button>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}>
      <Plus aria-hidden="true" weight="bold" />
      {label}
    </button>
  );
}

/** A plain labelled input for types the shared fields do not cover. */
export function InputField({
  label,
  value,
  onChange,
  type,
  maxLength,
  placeholder,
  required,
}: {
  label: string;
  value: string | null;
  onChange: (value: string | null) => void;
  type: 'date' | 'url' | 'datetime-local';
  maxLength?: number;
  placeholder?: string;
  required?: boolean;
}) {
  const id = useId();
  if (type === 'date') {
    return <DateField label={label} value={value} required={required} onChange={onChange} />;
  }
  if (type === 'datetime-local') {
    return <DateTimeField label={label} value={value} required={required} onChange={onChange} />;
  }
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input
        id={id}
        type={type}
        value={value ?? ''}
        maxLength={maxLength}
        placeholder={placeholder}
        required={required}
        onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
      />
    </div>
  );
}

// --- Seasons -----------------------------------------------------------------------------------

const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'] as const;
const monthLabels = () =>
  Object.fromEntries(
    MONTHS.map((m) => [
      m,
      new Date(Date.UTC(2024, Number(m) - 1, 1)).toLocaleString(localeOf(i18next.language), {
        month: 'long',
        timeZone: 'UTC',
      }),
    ]),
  ) as Record<(typeof MONTHS)[number], string>;
const DAYS = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));
const DAY_LABELS = Object.fromEntries(DAYS.map((d) => [d, String(Number(d))]));

type Month = (typeof MONTHS)[number];

function MonthDay({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const [month = '01', day = '01'] = value.split('-');
  return (
    <div className="month-day">
      <SelectField
        label={t('rows.monthOf', { label })}
        value={month as Month}
        options={MONTHS}
        labels={monthLabels()}
        onChange={(m) => m && onChange(`${m}-${day}`)}
      />
      <SelectField
        label={t('rows.dayOf', { label })}
        value={day}
        options={DAYS}
        labels={DAY_LABELS}
        onChange={(d) => d && onChange(`${month}-${d}`)}
      />
    </div>
  );
}

export function SeasonsEditor({
  seasons,
  onChange,
}: {
  seasons: Season[];
  onChange: (seasons: Season[]) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const _labels = useLabels();
  return (
    <fieldset className="row-editor">
      {/* The Section heading shows the name; the legend is for screen readers. */}
      <legend className="visually-hidden">{t('rows.seasons')}</legend>
      {seasons.length === 0 ? <p className="muted">{t('rows.noSeason')}</p> : null}
      {seasons.map((s, i) => (
        // Rows have no identity of their own; the index is the row.
        // biome-ignore lint/suspicious/noArrayIndexKey: see above
        <div className="row-editor-item season-row" key={i}>
          <MonthDay
            label={t('rows.from')}
            value={s.from}
            onChange={(from) => onChange(replaceAt(seasons, i, { ...s, from }))}
          />
          <MonthDay
            label={t('rows.to')}
            value={s.to}
            onChange={(to) => onChange(replaceAt(seasons, i, { ...s, to }))}
          />
          <RemoveButton
            label={t('rows.removeSeason', { n: i + 1 })}
            onClick={() => onChange(without(seasons, i))}
          />
        </div>
      ))}
      {seasons.length < CATALOG_LIMITS.seasonsPerRecord ? (
        <AddButton
          label={t('rows.addSeason')}
          onClick={() => onChange([...seasons, { from: '05-01', to: '09-30' }])}
        />
      ) : null}
      <small>{t('rows.seasonHint')}</small>
    </fieldset>
  );
}

// --- Opening hours -----------------------------------------------------------------------------

const WEEKDAYS = ['1', '2', '3', '4', '5', '6', '7'] as const;
const weekdayOptionLabels = () =>
  Object.fromEntries(WEEKDAYS.map((d) => [d, currentLabels().weekday[Number(d)] ?? d])) as Record<
    (typeof WEEKDAYS)[number],
    string
  >;

export function OpeningHoursEditor({
  hours,
  onChange,
}: {
  hours: OpeningHours[];
  onChange: (hours: OpeningHours[]) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const last = hours.at(-1);
  const template = {
    opens: last?.opens ?? '09:00',
    closes: last?.closes ?? '17:00',
    validFrom: last?.validFrom ?? null,
    validTo: last?.validTo ?? null,
  };
  return (
    <fieldset className="row-editor">
      <legend className="visually-hidden">{t('rows.hours')}</legend>
      {hours.length === 0 ? <p className="muted">{t('rows.noHours')}</p> : null}
      {hours.map((h, i) => {
        const set = (patch: Partial<OpeningHours>) =>
          onChange(replaceAt(hours, i, { ...h, ...patch }));
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
          <div className="row-editor-item" key={i}>
            <div className="hours-row">
              <SelectField
                label={t('rows.day')}
                value={String(h.weekday) as (typeof WEEKDAYS)[number]}
                options={WEEKDAYS}
                labels={weekdayOptionLabels()}
                onChange={(d) => d && set({ weekday: Number(d) })}
              />
              <TimeField
                label={t('rows.opens')}
                value={h.opens}
                onChange={(v) => v && set({ opens: v })}
              />
              <TimeField
                label={t('rows.closes')}
                value={h.closes}
                onChange={(v) => v && set({ closes: v })}
              />
            </div>
            <div className="validity-row">
              <InputField
                label={t('rows.validFrom')}
                type="date"
                value={h.validFrom}
                onChange={(validFrom) => set({ validFrom })}
              />
              <InputField
                label={t('rows.validTo')}
                type="date"
                value={h.validTo}
                onChange={(validTo) => set({ validTo })}
              />
              <RemoveButton
                label={t('rows.removeHours', { n: i + 1 })}
                onClick={() => onChange(without(hours, i))}
              />
            </div>
          </div>
        );
      })}
      <div className="actions">
        {hours.length < CATALOG_LIMITS.hoursPerRecord ? (
          <AddButton
            label={t('rows.addDay')}
            onClick={() => onChange([...hours, { weekday: 1, ...template }])}
          />
        ) : null}
        {hours.length + 7 <= CATALOG_LIMITS.hoursPerRecord ? (
          <AddButton
            label={t('rows.everyDay')}
            onClick={() =>
              onChange([
                ...hours,
                ...[1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ weekday, ...template })),
              ])
            }
          />
        ) : null}
      </div>
    </fieldset>
  );
}

// --- Images ------------------------------------------------------------------------------------

const isHttps = (url: string | null) => url !== null && /^https:\/\/\S+$/.test(url);

/** A thumbnail of the photo, or a note when the URL does not load. Remount it per URL. */
function ImagePreview({ url, alt }: { url: string; alt: string }) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <p className="image-preview image-broken" role="status">
        {t('rows.imageFailed')}
      </p>
    );
  }
  return (
    <img
      className="image-preview"
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setBroken(true)}
    />
  );
}

export function ImagesEditor({
  images,
  onChange,
}: {
  images: PlaceImage[];
  onChange: (images: PlaceImage[]) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  const labels = useLabels();
  return (
    <fieldset className="row-editor">
      <legend className="visually-hidden">{t('rows.photos')}</legend>
      {images.map((image, i) => {
        const set = (patch: Partial<PlaceImage>) =>
          onChange(replaceAt(images, i, { ...image, ...patch }));
        const commons = image.source === 'wikimedia_commons';
        const venue = image.source === 'venue_permission';
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
          <div className="row-editor-item image-row" key={i}>
            {isHttps(image.url) ? (
              <ImagePreview
                key={image.url}
                url={image.url}
                alt={image.attribution ?? t('rows.preview')}
              />
            ) : null}
            <InputField
              label={t('rows.imageUrl')}
              type="url"
              value={image.url}
              maxLength={CATALOG_LIMITS.url}
              placeholder="https://"
              required
              onChange={(url) => set({ url: url ?? '' })}
            />
            <SelectField
              label={t('rows.source')}
              value={image.source}
              options={IMAGE_SOURCES}
              labels={labels.imageSource}
              onChange={(source) => source && set({ source })}
            />
            <div className="field-row">
              <TextField
                label={commons ? t('rows.licenceRequired') : t('rows.licence')}
                placeholder="CC BY-SA 4.0"
                value={image.licence}
                maxLength={CATALOG_LIMITS.licence}
                required={commons}
                onChange={(licence) => set({ licence })}
              />
              <TextField
                label={commons || venue ? t('rows.attributionRequired') : t('rows.attribution')}
                hint={venue ? t('rows.permissionHint') : commons ? t('rows.authorHint') : undefined}
                value={image.attribution}
                maxLength={CATALOG_LIMITS.attribution}
                required={commons || venue}
                onChange={(attribution) => set({ attribution })}
              />
            </div>
            <InputField
              label={commons ? t('rows.filePageRequired') : t('rows.sourcePage')}
              type="url"
              value={image.sourcePageUrl}
              maxLength={CATALOG_LIMITS.url}
              placeholder="https://commons.wikimedia.org/wiki/File:…"
              required={commons}
              onChange={(sourcePageUrl) => set({ sourcePageUrl })}
            />
            <RemoveButton
              label={t('rows.removePhoto', { n: i + 1 })}
              onClick={() => onChange(without(images, i))}
            />
          </div>
        );
      })}
      {images.length < CATALOG_LIMITS.imagesPerPlace ? (
        <AddButton
          label={t('rows.addPhoto')}
          onClick={() =>
            onChange([
              ...images,
              {
                url: '',
                source: 'own_photo',
                licence: null,
                attribution: null,
                sourcePageUrl: null,
              },
            ])
          }
        />
      ) : null}
    </fieldset>
  );
}

// --- Links -------------------------------------------------------------------------------------

export function LinksEditor({
  links,
  onChange,
}: {
  links: CatalogLink[];
  onChange: (links: CatalogLink[]) => void;
}) {
  const { t } = useTranslation(['admin', 'common', 'host']);
  return (
    <fieldset className="row-editor">
      <legend className="visually-hidden">{t('rows.links')}</legend>
      {links.length === 0 ? <p className="muted">{t('rows.noLinks')}</p> : null}
      {links.map((link, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity of their own
        <div className="row-editor-item link-row" key={i}>
          <TextField
            label={t('rows.label')}
            placeholder={t('rows.labelPlaceholder')}
            value={link.label}
            maxLength={LIMITS.title}
            required
            onChange={(label) => onChange(replaceAt(links, i, { ...link, label: label ?? '' }))}
          />
          <InputField
            label="URL"
            type="url"
            placeholder="https://"
            value={link.url}
            maxLength={CATALOG_LIMITS.url}
            required
            onChange={(url) => onChange(replaceAt(links, i, { ...link, url: url ?? '' }))}
          />
          <RemoveButton
            label={t('rows.removeLink', { n: i + 1 })}
            onClick={() => onChange(without(links, i))}
          />
        </div>
      ))}
      {links.length < CATALOG_LIMITS.linksPerNote ? (
        <AddButton
          label={t('rows.addLink')}
          onClick={() => onChange([...links, { label: '', url: '' }])}
        />
      ) : null}
    </fieldset>
  );
}

// --- Sources -----------------------------------------------------------------------------------

export function SourcesEditor({
  kind,
  sources,
  onChange,
}: {
  kind: CatalogKind;
  sources: FieldSources;
  onChange: (sources: FieldSources) => void;
}) {
  const labels = useLabels();
  return (
    <>
      {SOURCE_FIELDS[kind].map((field) => (
        <InputField
          key={field}
          label={labels.sourceField[field]}
          type="url"
          placeholder="https://"
          value={sources[field] ?? null}
          maxLength={CATALOG_LIMITS.url}
          onChange={(url) => {
            const next = { ...sources };
            if (url === null) delete next[field];
            else next[field] = url;
            onChange(next);
          }}
        />
      ))}
    </>
  );
}
