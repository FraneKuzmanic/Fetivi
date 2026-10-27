/** "51–100 of 230" with Previous and Next, under a long table. */
export function Pager({
  offset,
  total,
  size,
  onChange,
}: {
  offset: number;
  total: number;
  size: number;
  onChange: (offset: number) => void;
}) {
  return (
    <div className="pager">
      <span>
        {offset + 1}–{Math.min(offset + size, total)} of {total}
      </span>
      <div className="actions">
        <button type="button" disabled={offset === 0} onClick={() => onChange(offset - size)}>
          Previous
        </button>
        <button
          type="button"
          disabled={offset + size >= total}
          onClick={() => onChange(offset + size)}
        >
          Next
        </button>
      </div>
    </div>
  );
}
