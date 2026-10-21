/** Short replies under Fetivi's answer; a tap sends the reply as the guest's next message. */
export function FollowUpChips({
  replies,
  label,
  onSelect,
}: {
  replies: readonly string[];
  /** Names the group for screen readers, e.g. "Suggested replies". */
  label: string;
  onSelect: (text: string) => void;
}) {
  return (
    <fieldset aria-label={label} className="fv-chips">
      {replies.map((reply) => (
        <button key={reply} type="button" className="fv-chip" onClick={() => onSelect(reply)}>
          {reply}
        </button>
      ))}
    </fieldset>
  );
}
