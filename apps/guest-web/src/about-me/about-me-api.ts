import type { AboutMe } from '@fetivi/domain/about-me-vocabulary';
import { api } from '../api';

export const getAboutMe = () => api<{ aboutMe: AboutMe }>('/api/about-me').then((r) => r.aboutMe);

/** Replaces the whole value: the guest's own tap, the only way needs are stored. */
export const saveAboutMe = (aboutMe: AboutMe) =>
  api<{ aboutMe: AboutMe }>('/api/about-me', { method: 'PUT', body: aboutMe }).then(
    (r) => r.aboutMe,
  );
