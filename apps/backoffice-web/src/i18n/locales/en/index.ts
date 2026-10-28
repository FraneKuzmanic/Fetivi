import { admin } from './admin';
import { auth } from './auth';
import { common } from './common';
import { errors } from './errors';
import { host } from './host';
import { labels } from './labels';
import { shell } from './shell';
import { wizard } from './wizard';

export const en = { common, auth, shell, labels, errors, host, admin, wizard };

export type Messages = typeof en;
