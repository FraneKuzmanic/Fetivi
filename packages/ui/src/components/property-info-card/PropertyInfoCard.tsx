import {
  Check,
  Clock,
  Copy,
  DoorOpen,
  type Icon,
  Key,
  Phone,
  SignOut,
  Siren,
  WifiHigh,
} from '@phosphor-icons/react';
import { useId, useRef, useState } from 'react';
import type {
  PropertyInfoField,
  PropertyInfoFieldEntry,
  PropertyInfoPayload,
  PropertyInfoTopic,
} from '../../payloads';

export interface PropertyInfoLabels {
  title: (topic: PropertyInfoTopic) => string;
  field: (key: PropertyInfoField) => string;
  /** The shown value: enums and 'yes'/'no' labelled, the rest as given. */
  value: (key: PropertyInfoField, raw: string) => string;
  /** "Shown from Tue 20 Oct, 00:00", in the property's zone. */
  releaseNote: (releaseAt: string, timezone: string) => string;
  noWifi: string;
  /** The copy button's name, e.g. "Copy Wi-Fi password". */
  copy: (fieldLabel: string) => string;
  copied: string;
  /** When the clipboard is refused: the text is selected instead. */
  copyFailed: string;
  /** The phone link's name, e.g. "Call Host". */
  call: (fieldLabel: string) => string;
}

const TOPIC_ICON: Record<PropertyInfoTopic, Icon> = {
  arrival: DoorOpen,
  wifi: WifiHigh,
  checkout: SignOut,
  contacts: Phone,
};

const FIELD_ICON: Partial<Record<PropertyInfoField, Icon>> = {
  buildingDoorCode: Key,
  doorCode: Key,
  lockboxCode: Key,
  wifiPassword: Key,
  emergencyNumber: Siren,
};

/** Only digits and a leading plus reach the dialler. */
const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

function selectText(node: HTMLElement | null) {
  const selection = node ? window.getSelection() : null;
  if (!node || !selection) return;
  const range = document.createRange();
  range.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(range);
}

function FieldValue({
  field,
  label,
  labels,
  onCopied,
}: {
  field: PropertyInfoFieldEntry;
  label: string;
  labels: PropertyInfoLabels;
  onCopied: (message: string) => void;
}) {
  const valueRef = useRef<HTMLElement | null>(null);
  const keep = (node: HTMLElement | null) => {
    valueRef.current = node;
  };
  const [done, setDone] = useState(false);
  const shown = labels.value(field.key, field.value);
  if (field.action === 'text') return <span className="fv-info-text">{shown}</span>;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(field.value);
      setDone(true);
      onCopied(labels.copied);
    } catch {
      selectText(valueRef.current);
      onCopied(labels.copyFailed);
    }
  };

  return (
    <span className="fv-info-secret">
      {field.action === 'tel' ? (
        <a
          ref={keep}
          className="fv-info-tel"
          href={telHref(field.value)}
          aria-label={`${labels.call(label)}: ${field.value}`}
        >
          {field.value}
        </a>
      ) : (
        <code ref={keep} className="fv-info-code">
          {field.value}
        </code>
      )}
      <button type="button" className="fv-info-copy" onClick={() => void copy()}>
        {done ? (
          <Check size={20} weight="bold" aria-hidden="true" />
        ) : (
          <Copy size={20} aria-hidden="true" />
        )}
        <span className="fv-visually-hidden">{labels.copy(label)}</span>
      </button>
    </span>
  );
}

/** One media item with its caption shown under it; for an image it is also the alt text. */
export function InfoMedia({
  media,
  mediaUrl,
}: {
  media: PropertyInfoPayload['media'];
  mediaUrl: (id: string) => string;
}) {
  const id = useId();
  if (media.length === 0) return null;
  return (
    <ul className="fv-media">
      {media.map((m, i) => (
        <li key={m.id}>
          <figure>
            {m.kind === 'image' ? (
              <img src={mediaUrl(m.id)} alt={m.caption} loading="lazy" />
            ) : (
              // biome-ignore lint/a11y/useMediaCaption: short host clips have no caption track; the figcaption describes them.
              <video
                src={mediaUrl(m.id)}
                controls
                preload="metadata"
                aria-describedby={`${id}-${i}`}
              />
            )}
            <figcaption id={`${id}-${i}`}>{m.caption}</figcaption>
          </figure>
        </li>
      ))}
    </ul>
  );
}

/** Typed unit facts for one topic, with copy buttons for codes and phones. Never model text. */
export function PropertyInfoCard({
  info,
  mediaUrl,
  labels,
  headingLevel = 3,
}: {
  info: PropertyInfoPayload;
  mediaUrl: (id: string) => string;
  labels: PropertyInfoLabels;
  headingLevel?: 2 | 3;
}) {
  const titleId = useId();
  const [status, setStatus] = useState('');
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  const TopicIcon = TOPIC_ICON[info.topic];

  return (
    <section className="fv-info" aria-labelledby={titleId}>
      <Heading id={titleId} className="fv-info-title">
        <TopicIcon size={22} aria-hidden="true" />
        {labels.title(info.topic)}
      </Heading>
      {info.releaseAt ? (
        <p className="fv-info-release">
          <Clock size={20} aria-hidden="true" />
          {labels.releaseNote(info.releaseAt, info.timezone)}
        </p>
      ) : null}
      {info.topic === 'wifi' && info.fields.length === 0 ? (
        <p className="fv-info-empty">{labels.noWifi}</p>
      ) : null}
      {info.fields.length > 0 ? (
        <dl className="fv-info-fields">
          {info.fields.map((field) => {
            const label = labels.field(field.key);
            const FieldIcon = FIELD_ICON[field.key];
            return (
              <div key={field.key}>
                <dt>
                  {FieldIcon ? <FieldIcon size={18} aria-hidden="true" /> : null}
                  {label}
                </dt>
                <dd>
                  <FieldValue field={field} label={label} labels={labels} onCopied={setStatus} />
                </dd>
              </div>
            );
          })}
        </dl>
      ) : null}
      <InfoMedia media={info.media} mediaUrl={mediaUrl} />
      <p className="fv-visually-hidden" role="status">
        {status}
      </p>
    </section>
  );
}
