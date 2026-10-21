import type { GuestProjection } from '@fetivi/domain/projection-types';
import type { PlaceCardPayload } from '@fetivi/ui/payloads';
import { api } from '../api';

/** The unit record in the Space's language, read without a model. */
export const getUnit = () => api<{ unit: GuestProjection }>('/api/unit').then((r) => r.unit);

/** The Space's saved places as cards, newest first. */
export const getSavedPlaceCards = () =>
  api<{ places: PlaceCardPayload[] }>('/api/guide/saved-places').then((r) => r.places);

/** Where a block photo or video is fetched; the server checks it against the Space. */
export const mediaUrl = (id: string) => `/api/media/${encodeURIComponent(id)}`;
