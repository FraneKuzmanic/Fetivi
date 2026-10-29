import { Translate } from '@phosphor-icons/react';

/**
 * Short replies under Fetivi's answer; a tap sends the reply as the guest's next message.
 * `switchTo` adds one more chip, in its own language, that switches Fetivi's language instead
 * (ticket 63).
 */
export function FollowUpChips({
  replies,
  label,
  onSelect,
  switchTo,
}: {
  replies: readonly string[];
  /** Names the group for screen readers, e.g. "Suggested replies". */
  label: string;
  onSelect: (text: string) => void;
  switchTo?: { label: string; lang: string; onSelect: () => void };
}) {
  return (
    <fieldset aria-label={label} className="fv-chips">
      {replies.map((reply) => (
        <button key={reply} type="button" className="fv-chip" onClick={() => onSelect(reply)}>
          {reply}
        </button>
      ))}
      {switchTo && (
        <button
          type="button"
          className="fv-chip fv-chip-language"
          lang={switchTo.lang}
          onClick={(event) => {
            // The chip goes away once Fetivi switches: keep the keyboard on the first reply.
            event.currentTarget.parentElement?.querySelector('button')?.focus();
            switchTo.onSelect();
          }}
        >
          <Translate aria-hidden="true" />
          {switchTo.label}
        </button>
      )}
    </fieldset>
  );
}
