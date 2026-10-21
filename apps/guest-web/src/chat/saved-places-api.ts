import { api } from '../api';

type SavedPlaces = { placeIds: string[] };

export const getSavedPlaces = () => api<SavedPlaces>('/api/saved-places').then((r) => r.placeIds);

/** The guest's Save tap on a place card; answers with every saved id. */
export const savePlace = (id: string) =>
  api<SavedPlaces>(`/api/saved-places/${encodeURIComponent(id)}`, { method: 'PUT' }).then(
    (r) => r.placeIds,
  );

export const unsavePlace = (id: string) =>
  api<SavedPlaces>(`/api/saved-places/${encodeURIComponent(id)}`, { method: 'DELETE' }).then(
    (r) => r.placeIds,
  );
