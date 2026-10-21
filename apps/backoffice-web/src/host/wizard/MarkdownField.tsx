import { LIMITS } from '@fetivi/domain/vocabulary';
import { LinkSimple, ListBullets, ListNumbers, TextB } from '@phosphor-icons/react';
import { useId, useRef } from 'react';
import { format, useWizardCopy } from './copy';

type Edit = (text: string, start: number, end: number) => [string, number, number];

/** Wraps the selection, or inserts the markers with the cursor between them. */
const wrap =
  (before: string, after: string, fallback: string): Edit =>
  (text, start, end) => {
    const inner = text.slice(start, end) || fallback;
    return [
      `${before}${inner}${after}`,
      start + before.length,
      start + before.length + inner.length,
    ];
  };

/** Prefixes every line the selection touches. */
const prefixLines =
  (prefix: (i: number) => string): Edit =>
  (text, start, end) => {
    const lineStart = text.lastIndexOf('\n', start - 1) + 1;
    const lines = text.slice(lineStart, end).split('\n');
    const out = lines.map((line, i) => `${prefix(i)}${line}`).join('\n');
    return [out, lineStart, lineStart + out.length];
  };

/** A Markdown textarea with a small toolbar; the text is stored as typed (architecture §7). */
export function MarkdownField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange: (value: string) => void;
}) {
  const { ui } = useWizardCopy();
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);

  function apply(edit: Edit, replaceFrom?: 'line') {
    const area = ref.current;
    if (!area) return;
    const { selectionStart: start, selectionEnd: end } = area;
    const [text, selStart, selEnd] = edit(area.value, start, end);
    const from = replaceFrom === 'line' ? area.value.lastIndexOf('\n', start - 1) + 1 : start;
    area.setRangeText(text, from, end, 'preserve');
    area.setSelectionRange(selStart, selEnd);
    area.focus();
    onChange(area.value);
  }

  const tools = [
    { label: ui.bold, icon: <TextB />, run: () => apply(wrap('**', '**', ui.bold)) },
    {
      label: ui.bulletList,
      icon: <ListBullets />,
      run: () =>
        apply(
          prefixLines(() => '- '),
          'line',
        ),
    },
    {
      label: ui.numberedList,
      icon: <ListNumbers />,
      run: () =>
        apply(
          prefixLines((i) => `${i + 1}. `),
          'line',
        ),
    },
    { label: ui.link, icon: <LinkSimple />, run: () => apply(wrap('[', '](https://)', ui.link)) },
  ];

  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <div className="md-toolbar" role="toolbar" aria-controls={id}>
        {tools.map((tool) => (
          <button
            key={tool.label}
            type="button"
            className="icon-button md-tool"
            aria-label={tool.label}
            title={tool.label}
            onClick={tool.run}
          >
            {tool.icon}
          </button>
        ))}
      </div>
      <textarea
        id={id}
        ref={ref}
        rows={6}
        value={value}
        maxLength={LIMITS.blockBody}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
      <small>{format(ui.charactersLeft, { n: LIMITS.blockBody - value.length })}</small>
    </div>
  );
}
