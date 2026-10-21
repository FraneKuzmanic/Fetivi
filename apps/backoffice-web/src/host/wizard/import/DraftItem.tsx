import { CHECK_IN_METHODS, LIMITS, PARKING_TYPES } from '@fetivi/domain/vocabulary';
import { wizardField } from '@fetivi/domain/wizard';
import { Check, PencilSimple, X } from '@phosphor-icons/react';
import { type ReactNode, useState } from 'react';
import type {
  AmenityEntry,
  ConfirmBody,
  ManualDraftColumn,
  ManualDraftItem,
  ManualDraftValues,
  SecretWarning,
} from '../../../api';
import {
  CheckboxField,
  NumberField,
  SelectField,
  TextArea,
  TextField,
  TimeField,
  TriStateField,
} from '../../../forms/fields';
import { useAction } from '../../../useAction';
import { SecretWarnings } from '../../BlockEditor';
import { format, useWizardCopy } from '../copy';
import { MarkdownField } from '../MarkdownField';
import type { DraftValues } from '../targets';
import {
  columnInput,
  columnLabel,
  columnMaxLength,
  draftColumns,
  formatDraftValue,
  savedSummary,
} from './drafts';

type FieldDraft = Extract<ManualDraftItem, { kind: 'field' }>;
type AmenitiesDraft = Extract<ManualDraftItem, { kind: 'amenities' }>;
type BlockDraft = Extract<ManualDraftItem, { kind: 'block' }>;

export type Confirm = (body: ConfirmBody) => Promise<SecretWarning[]>;

/** The row frame shared by every draft: the tag, the content, the state or the actions. */
export function DraftRow({
  item,
  title,
  children,
  actions,
  after,
}: {
  item: ManualDraftItem;
  title: ReactNode;
  children: ReactNode;
  actions: ReactNode;
  /** An error or the warnings of a confirm, under the row. */
  after?: ReactNode;
}) {
  const mi = useWizardCopy().manualImport;
  return (
    <li className="manual-row">
      <div className="manual-row-head">
        <span className="chip manual-tag">{mi.fromManual}</span>
        <span className="manual-row-title">{title}</span>
        {item.status === 'confirmed' ? (
          <span className="chip ok">
            <Check aria-hidden="true" weight="bold" /> {mi.confirmed}
          </span>
        ) : item.status === 'dismissed' ? (
          <span className="chip neutral">{mi.dismissed}</span>
        ) : null}
      </div>
      {children}
      {item.status === 'pending' ? actions : null}
      {after}
    </li>
  );
}

/** Confirm, Edit and Dismiss of a draft in view mode. */
function ViewActions({
  busy,
  onConfirm,
  onEdit,
  onDismiss,
}: {
  busy: boolean;
  onConfirm: () => void;
  onEdit: () => void;
  onDismiss: () => void;
}) {
  const mi = useWizardCopy().manualImport;
  return (
    <div className="actions manual-actions">
      <button type="button" className="primary" disabled={busy} onClick={onConfirm}>
        <Check aria-hidden="true" weight="bold" />
        {mi.confirm}
      </button>
      <button type="button" disabled={busy} onClick={onEdit}>
        <PencilSimple aria-hidden="true" />
        {mi.edit}
      </button>
      <button type="button" className="ghost" disabled={busy} onClick={onDismiss}>
        <X aria-hidden="true" />
        {mi.dismiss}
      </button>
    </div>
  );
}

function EditActions({
  busy,
  disabled,
  onSave,
  onCancel,
}: {
  busy: boolean;
  disabled?: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const copy = useWizardCopy();
  return (
    <div className="actions manual-actions">
      <button type="button" className="primary" disabled={busy || disabled} onClick={onSave}>
        <Check aria-hidden="true" weight="bold" />
        {copy.manualImport.confirm}
      </button>
      <button type="button" disabled={busy} onClick={onCancel}>
        {copy.ui.cancel}
      </button>
    </div>
  );
}

/** One field, amenities or block draft, viewed or edited; confirming the edit saves it. */
export function DraftItem({
  item,
  loaded,
  onConfirm,
  onDismiss,
}: {
  item: Exclude<ManualDraftItem, { kind: 'unmapped' }>;
  loaded: DraftValues;
  onConfirm: Confirm;
  onDismiss: () => Promise<void>;
}) {
  const { busy, error, run } = useAction();
  const [editing, setEditing] = useState(false);
  const [warnings, setWarnings] = useState<SecretWarning[]>([]);

  const confirm = (body: ConfirmBody) =>
    void run(async () => {
      setWarnings(await onConfirm(body));
      setEditing(false);
    });
  const after = (
    <>
      {error ? <p role="alert">{error}</p> : null}
      {warnings.length > 0 ? <SecretWarnings warnings={warnings} /> : null}
    </>
  );
  const common = {
    after,
    busy,
    editing,
    onEdit: () => setEditing(true),
    onCancel: () => setEditing(false),
    onDismiss: () => void run(onDismiss),
    confirm,
  };

  if (item.kind === 'field') return <FieldDraftRow item={item} loaded={loaded} {...common} />;
  if (item.kind === 'amenities') return <AmenitiesDraftRow item={item} {...common} />;
  return <BlockDraftRow item={item} {...common} />;
}

interface RowProps<T> {
  item: T;
  after: ReactNode;
  busy: boolean;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onDismiss: () => void;
  confirm: (body: ConfirmBody) => void;
}

function FieldDraftRow({
  item,
  loaded,
  busy,
  editing,
  onEdit,
  onCancel,
  onDismiss,
  confirm,
  after,
}: RowProps<FieldDraft> & { loaded: DraftValues }) {
  const copy = useWizardCopy();
  const [values, setValues] = useState<ManualDraftValues>(item.values);
  const columns = draftColumns(item);
  const now = item.status === 'pending' ? savedSummary(item, loaded, copy) : null;
  // A draft may hold only some of a field's columns: the field decides whether they need labels.
  const multi = wizardField(item.fieldId).columns.length > 1;

  return (
    <DraftRow
      item={item}
      after={after}
      title={copy.fields[item.fieldId].label}
      actions={
        editing ? (
          <EditActions busy={busy} onSave={() => confirm({ values })} onCancel={onCancel} />
        ) : (
          <ViewActions
            busy={busy}
            onConfirm={() => confirm({ values: item.values })}
            onEdit={() => {
              setValues(item.values);
              onEdit();
            }}
            onDismiss={onDismiss}
          />
        )
      }
    >
      {editing ? (
        <div className="manual-editor">
          {columns.map((column) => (
            <ColumnEditor
              key={column}
              label={columnLabel(item, column, copy)}
              column={column}
              value={values[column]}
              onChange={(value) => setValues((v) => ({ ...v, [column]: value }))}
            />
          ))}
        </div>
      ) : (
        <dl className="manual-values">
          {columns.map((column) => (
            <div key={column}>
              {multi ? <dt>{columnLabel(item, column, copy)}</dt> : null}
              <dd>{formatDraftValue(column, item.values[column], copy)}</dd>
            </div>
          ))}
        </dl>
      )}
      {now ? (
        <p className="muted manual-now">{format(copy.manualImport.now, { value: now })}</p>
      ) : null}
    </DraftRow>
  );
}

/** The input for one column; beds are only shown here and changed in the step. */
function ColumnEditor({
  label,
  column,
  value,
  onChange,
}: {
  label: string;
  column: ManualDraftColumn;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const copy = useWizardCopy();
  const { ui } = copy;
  switch (columnInput(column)) {
    case 'time':
      return (
        <TimeField label={label} value={(value as string | null) ?? null} onChange={onChange} />
      );
    case 'enum':
      return column === 'checkInMethod' ? (
        <SelectField
          label={label}
          value={(value as (typeof CHECK_IN_METHODS)[number] | null) ?? null}
          options={CHECK_IN_METHODS}
          labels={copy.checkInMethods}
          emptyLabel={ui.notSet}
          onChange={onChange}
        />
      ) : (
        <SelectField
          label={label}
          value={(value as (typeof PARKING_TYPES)[number] | null) ?? null}
          options={PARKING_TYPES}
          labels={copy.parkingTypes}
          emptyLabel={ui.notSet}
          onChange={onChange}
        />
      );
    case 'tri':
      return (
        <TriStateField
          label={label}
          value={(value as boolean | null) ?? null}
          nullLabel={ui.notSet}
          yesLabel={ui.yes}
          noLabel={ui.no}
          onChange={onChange}
        />
      );
    case 'bool':
      return <CheckboxField label={label} checked={value === true} onChange={onChange} />;
    case 'int':
      return (
        <NumberField
          label={label}
          value={(value as number | null) ?? null}
          min={0}
          max={50}
          onChange={onChange}
        />
      );
    case 'long':
      return (
        <TextArea
          label={label}
          value={(value as string | null) ?? null}
          maxLength={columnMaxLength(column)}
          rows={3}
          onChange={onChange}
        />
      );
    case 'beds':
      return (
        <div className="field">
          <span className="field-label">{label}</span>
          <span>{formatDraftValue(column, value, copy)}</span>
          <small>{copy.manualImport.bedsHint}</small>
        </div>
      );
    default:
      return (
        <TextField
          label={label}
          type={columnInput(column) === 'phone' ? 'tel' : 'text'}
          value={(value as string | null) ?? null}
          maxLength={columnMaxLength(column)}
          onChange={onChange}
        />
      );
  }
}

function AmenitiesDraftRow({
  item,
  busy,
  editing,
  onEdit,
  onCancel,
  onDismiss,
  confirm,
  after,
}: RowProps<AmenitiesDraft>) {
  const copy = useWizardCopy();
  const [chosen, setChosen] = useState<AmenityEntry[]>(item.amenities);
  const isChosen = (a: AmenityEntry) => chosen.some((c) => c.amenity === a.amenity);
  const label = (a: AmenityEntry) =>
    a.note ? `${copy.amenities[a.amenity]} (${a.note})` : copy.amenities[a.amenity];

  return (
    <DraftRow
      item={item}
      after={after}
      title={copy.manualImport.amenitiesLabel}
      actions={
        editing ? (
          <EditActions
            busy={busy}
            disabled={chosen.length === 0}
            onSave={() => confirm({ amenities: chosen })}
            onCancel={onCancel}
          />
        ) : (
          <ViewActions
            busy={busy}
            onConfirm={() => confirm({ amenities: item.amenities })}
            onEdit={() => {
              setChosen(item.amenities);
              onEdit();
            }}
            onDismiss={onDismiss}
          />
        )
      }
    >
      {editing ? (
        <ul className="amenities">
          {item.amenities.map((a) => (
            <li key={a.amenity}>
              <CheckboxField
                label={label(a)}
                checked={isChosen(a)}
                onChange={(on) =>
                  setChosen((list) =>
                    on ? [...list, a] : list.filter((c) => c.amenity !== a.amenity),
                  )
                }
              />
            </li>
          ))}
        </ul>
      ) : (
        <p className="manual-text">{item.amenities.map(label).join(', ')}</p>
      )}
    </DraftRow>
  );
}

function BlockDraftRow({
  item,
  busy,
  editing,
  onEdit,
  onCancel,
  onDismiss,
  confirm,
  after,
}: RowProps<BlockDraft>) {
  const copy = useWizardCopy();
  const [title, setTitle] = useState<string | null>(item.title);
  const [body, setBody] = useState(item.body);
  const valid =
    (title ?? '').trim() !== '' && body.trim() !== '' && body.length <= LIMITS.blockBody;

  return (
    <DraftRow
      item={item}
      after={after}
      title={item.title}
      actions={
        editing ? (
          <EditActions
            busy={busy}
            disabled={!valid}
            onSave={() => confirm({ title: title ?? '', body })}
            onCancel={onCancel}
          />
        ) : (
          <ViewActions
            busy={busy}
            // A body over the limit has to be shortened in the editor first.
            onConfirm={() =>
              item.body.length > LIMITS.blockBody
                ? onEdit()
                : confirm({ title: item.title, body: item.body })
            }
            onEdit={() => {
              setTitle(item.title);
              setBody(item.body);
              onEdit();
            }}
            onDismiss={onDismiss}
          />
        )
      }
    >
      {editing ? (
        <div className="manual-editor">
          <TextField
            label={copy.ui.blockTitle}
            value={title}
            maxLength={LIMITS.title}
            required
            onChange={setTitle}
          />
          <MarkdownField label={copy.ui.blockBody} value={body} onChange={setBody} />
        </div>
      ) : (
        <p className="manual-text">{item.body}</p>
      )}
      {item.scrubbed ? <p className="muted">{copy.manualImport.scrubbed}</p> : null}
      {item.status === 'pending' && item.warnings.length > 0 ? (
        <SecretWarnings warnings={item.warnings} lead={copy.manualImport.checkWarnings} />
      ) : null}
    </DraftRow>
  );
}
