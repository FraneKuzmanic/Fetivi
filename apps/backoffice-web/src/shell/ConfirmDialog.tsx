import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from 'react';

export interface ConfirmOptions {
  /** A question that names the thing, e.g. "Delete Trogir?". */
  title: string;
  /** What happens next, in a sentence or two. */
  body?: ReactNode;
  /** The button that goes ahead, named for the action: "Delete destination", "Refund €45.00". */
  action: string;
  /** Red action button, for what cannot be undone. */
  danger?: boolean;
}

type Ask = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<Ask | null>(null);

/**
 * Asks before a consequential action, in the page's own dialog rather than the browser's.
 * Escape, Cancel and a click on the backdrop all answer no. Focus starts on Cancel when the
 * action cannot be undone, and returns to where it was afterwards.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [asking, setAsking] = useState<{
    options: ConfirmOptions;
    answer: (yes: boolean) => void;
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const go = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();

  const ask = useCallback<Ask>(
    (options) =>
      new Promise((resolve) => {
        returnTo.current = document.activeElement as HTMLElement | null;
        setAsking({ options, answer: resolve });
      }),
    [],
  );

  const close = (yes: boolean) => {
    asking?.answer(yes);
    setAsking(null);
    dialog.current?.close?.();
    returnTo.current?.focus?.();
  };

  useEffect(() => {
    const node = dialog.current;
    if (!asking || !node) return;
    if (typeof node.showModal === 'function' && !node.open) node.showModal();
    else node.setAttribute('open', '');
    (asking.options.danger ? cancel : go).current?.focus();
  }, [asking]);

  return (
    <ConfirmContext.Provider value={ask}>
      {children}
      {asking ? (
        // biome-ignore lint/a11y/useKeyWithClickEvents: a click on the backdrop; Escape answers no via onCancel.
        <dialog
          ref={dialog}
          className="confirm-dialog"
          aria-labelledby={titleId}
          aria-describedby={asking.options.body ? bodyId : undefined}
          onCancel={(event) => {
            event.preventDefault();
            close(false);
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close(false);
          }}
        >
          <div className="confirm-body">
            <h2 id={titleId}>{asking.options.title}</h2>
            {asking.options.body ? (
              <div id={bodyId} className="muted">
                {asking.options.body}
              </div>
            ) : null}
          </div>
          <div className="confirm-actions">
            <button ref={cancel} type="button" onClick={() => close(false)}>
              Cancel
            </button>
            <button
              ref={go}
              type="button"
              className={asking.options.danger ? 'danger-solid' : 'primary'}
              onClick={() => close(true)}
            >
              {asking.options.action}
            </button>
          </div>
        </dialog>
      ) : null}
    </ConfirmContext.Provider>
  );
}

/** `if (await confirm({ title, action })) …` inside a ConfirmProvider. */
export function useConfirm(): Ask {
  const ask = useContext(ConfirmContext);
  return (
    ask ??
    (() => {
      throw new Error('useConfirm outside ConfirmProvider');
    })
  );
}
