import type { Translation } from '../../types';
import type { wizard as en } from '../en/wizard';

export const wizard: Translation<typeof en> = {
  requiredLeft_one: 'Još {{count}} obavezno polje',
  requiredLeft_few: 'Još {{count}} obavezna polja',
  requiredLeft_other: 'Još {{count}} obaveznih polja',
  recommendedLeft_one: 'Još {{count}} preporučeno polje',
  recommendedLeft_few: 'Još {{count}} preporučena polja',
  recommendedLeft_other: 'Još {{count}} preporučenih polja',
  charactersLeft_one: 'Preostao {{count}} znak',
  charactersLeft_few: 'Preostala {{count}} znaka',
  charactersLeft_other: 'Preostalo {{count}} znakova',
  releaseDays_one: '{{count}} dan prije prijave',
  releaseDays_few: '{{count}} dana prije prijave',
  releaseDays_other: '{{count}} dana prije prijave',
  pendingCount_one: '{{count}} nacrt iz vaših uputa za pregled',
  pendingCount_few: '{{count}} nacrta iz vaših uputa za pregled',
  pendingCount_other: '{{count}} nacrta iz vaših uputa za pregled',
  stepNotice_one: '{{count}} nacrt iz vaših uputa za ovaj korak',
  stepNotice_few: '{{count}} nacrta iz vaših uputa za ovaj korak',
  stepNotice_other: '{{count}} nacrta iz vaših uputa za ovaj korak',
};
