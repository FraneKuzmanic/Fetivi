import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getSavedPlaces, savePlace, unsavePlace } from '../saved-places-api';

interface SavedPlacesValue {
  saved: ReadonlySet<string>;
  /** False after the Stay: saved places can only be removed. */
  canSave: boolean;
  toggle: (id: string, next: boolean) => void;
}

const SavedPlacesContext = createContext<SavedPlacesValue>({
  saved: new Set(),
  canSave: false,
  toggle: () => {},
});

export const useSavedPlaces = () => useContext(SavedPlacesContext);

/**
 * The Space's saved places for the cards in the chat. Loads once; a tap changes the card at once
 * and is undone, with a polite note, if the server refuses it.
 */
export function SavedPlacesProvider({
  closed,
  children,
}: {
  closed: boolean;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const [saved, setSaved] = useState<ReadonlySet<string>>(new Set());
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let current = true;
    // Without the list every card starts unsaved; saving still works.
    getSavedPlaces().then(
      (ids) => current && setSaved(new Set(ids)),
      () => {},
    );
    return () => {
      current = false;
    };
  }, []);

  const toggle = useCallback((id: string, next: boolean) => {
    setFailed(false);
    const change = (on: boolean) =>
      setSaved((s) => {
        const copy = new Set(s);
        if (on) copy.add(id);
        else copy.delete(id);
        return copy;
      });
    change(next);
    (next ? savePlace(id) : unsavePlace(id)).then(
      (ids) => setSaved(new Set(ids)),
      () => {
        change(!next);
        setFailed(true);
      },
    );
  }, []);

  return (
    <SavedPlacesContext.Provider value={{ saved, canSave: !closed, toggle }}>
      {children}
      <p className="save-error-note" role="status">
        {failed ? t('components.saveError') : ''}
      </p>
    </SavedPlacesContext.Provider>
  );
}
