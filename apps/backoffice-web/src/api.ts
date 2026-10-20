import type {
  CatalogKind,
  ImageSource,
  PlaceCategory,
  SourceField,
  StalenessStatus,
  TransportMode,
} from '@fetivi/domain/catalog-vocabulary';
import type {
  Amenity,
  Bed,
  BlockCategory,
  BlockVisibility,
  CheckInMethod,
  GuestLanguage,
  HostBlockCategory,
  ParkingType,
  SourceLanguage,
  TranslationError,
  TranslationOrigin,
  TranslationStatus,
} from '@fetivi/domain/vocabulary';

export class ApiError extends Error {
  override name = 'ApiError';
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(code);
  }
}

export async function api<T>(
  path: string,
  { method = 'GET', body }: { method?: string; body?: unknown } = {},
): Promise<T> {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    credentials: 'same-origin',
  });
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(response.status, json?.error ?? 'internal');
  return json as T;
}

export interface Me {
  account: { id: string; email: string; role: 'host' | 'admin' };
  actingAs: { id: string; email: string } | null;
}

export interface HostSummary {
  id: string;
  email: string;
  emailVerified: boolean;
  suspended: boolean;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  adminId: string;
  hostId: string;
  hostEmail: string;
  method: string;
  route: string;
  statusCode: number | null;
  createdAt: string;
}

export interface CoreValues {
  checkInTime: string | null;
  checkoutTime: string | null;
  checkInMethod: CheckInMethod | null;
  accessInstructions: string | null;
  parkingType: ParkingType | null;
  parkingNotes: string | null;
  petsAllowed: boolean | null;
  smokingAllowed: boolean | null;
  partiesAllowed: boolean | null;
  quietHoursFrom: string | null;
  quietHoursTo: string | null;
  houseRulesNotes: string | null;
  hostPhone: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  licenceNumber: string | null;
}

export interface AmenityEntry {
  amenity: Amenity;
  note: string | null;
}

export interface Block {
  id: string;
  propertyId: string | null;
  unitId: string | null;
  category: BlockCategory;
  title: string;
  body: string;
  visibility: BlockVisibility;
  revision: number;
  translation: BlockTranslation;
  replacesBlockId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
}

export interface BlockTranslation {
  status: TranslationStatus;
  error: TranslationError | null;
  publishedRevision: number | null;
  sourceLanguage: SourceLanguage | null;
}

export interface TranslationsView {
  blockId: string;
  revision: number;
  publishedRevision: number | null;
  status: TranslationStatus;
  error: TranslationError | null;
  sourceLanguage: SourceLanguage | null;
  languages: {
    language: GuestLanguage;
    current: { title: string; body: string; origin: TranslationOrigin; updatedAt: string } | null;
    published: { title: string; body: string; origin: TranslationOrigin } | null;
  }[];
}

export interface BlockInput {
  category: HostBlockCategory;
  title: string;
  body: string;
  visibility?: BlockVisibility;
  position?: number;
  replacesBlockId?: string | null;
}

export interface SecretWarning {
  kind: 'phone' | 'code' | 'password';
  excerpt: string;
}

export interface BlockResult {
  block: Block;
  warnings: SecretWarning[];
}

export interface PropertySummary {
  id: string;
  name: string;
  city: string | null;
  approved: boolean;
  units: { id: string; name: string; hasQr: boolean }[];
}

export interface PropertyDetail extends CoreValues {
  id: string;
  name: string;
  addressLine: string | null;
  city: string | null;
  postalCode: string | null;
  country: string;
  location: { lat: number; lng: number } | null;
  timezone: string;
  buildingDoorCode: string | null;
  approved: boolean;
  amenities: AmenityEntry[];
  blocks: Block[];
  units: { id: string; name: string; qrSlug: string | null }[];
}

export type PropertyPatch = Partial<
  Omit<PropertyDetail, 'id' | 'approved' | 'amenities' | 'blocks' | 'units'>
>;

export interface UnitDetail extends CoreValues {
  id: string;
  propertyId: string;
  propertyName: string;
  name: string;
  qrSlug: string | null;
  qrLink: string | null;
  approved: boolean;
  timezone: string;
  noWifi: boolean;
  wifiNetwork: string | null;
  wifiPassword: string | null;
  doorCode: string | null;
  lockboxCode: string | null;
  maxOccupancy: number | null;
  bedrooms: number | null;
  beds: Bed[];
  bathrooms: number | null;
  arrivalReleaseDaysBefore: number;
  propertyValues: CoreValues;
  propertyAmenities: AmenityEntry[];
  amenities: AmenityEntry[];
  blocks: Block[];
  propertyBlocks: Block[];
  hiddenBlockIds: string[];
  effective: {
    inherited: Record<keyof CoreValues, boolean>;
    blocks: (Block & { source: 'property' | 'unit' })[];
    amenities: AmenityEntry[];
  };
}

export type UnitPatch = Partial<
  Pick<
    UnitDetail,
    | keyof CoreValues
    | 'name'
    | 'noWifi'
    | 'wifiNetwork'
    | 'wifiPassword'
    | 'doorCode'
    | 'lockboxCode'
    | 'maxOccupancy'
    | 'bedrooms'
    | 'beds'
    | 'bathrooms'
    | 'arrivalReleaseDaysBefore'
  >
>;

export interface AdminPropertyRow {
  id: string;
  name: string;
  city: string | null;
  hostEmail: string;
  unitCount: number;
  createdAt: string;
  approvedAt: string | null;
}

const post = <T = void>(path: string, body?: unknown) => api<T>(path, { method: 'POST', body });
const patch = <T>(path: string, body: unknown) => api<T>(path, { method: 'PATCH', body });
const put = <T>(path: string, body: unknown) => api<T>(path, { method: 'PUT', body });
const remove = (path: string) => api<void>(path, { method: 'DELETE' });

export const auth = {
  me: () => api<Me>('/api/auth/me'),
  login: (email: string, password: string) => post<Me>('/api/auth/login', { email, password }),
  logout: () => post('/api/auth/logout'),
  signUp: (email: string, password: string) => post('/api/auth/sign-up', { email, password }),
  verifyEmail: (token: string) => post('/api/auth/verify-email', { token }),
  resendVerification: (email: string) => post('/api/auth/resend-verification', { email }),
  requestReset: (email: string) => post('/api/auth/password-reset/request', { email }),
  confirmReset: (token: string, password: string) =>
    post('/api/auth/password-reset/confirm', { token, password }),
};

export const admin = {
  hosts: () => api<{ hosts: HostSummary[] }>('/api/admin/hosts'),
  suspend: (id: string) => post(`/api/admin/hosts/${id}/suspend`),
  unsuspend: (id: string) => post(`/api/admin/hosts/${id}/unsuspend`),
  remove: (id: string) => api<void>(`/api/admin/hosts/${id}`, { method: 'DELETE' }),
  actAs: (hostId: string) => post<Me>('/api/admin/act-as', { hostId }),
  stopActing: () => post<Me>('/api/admin/act-as/stop'),
  audit: () => api<{ entries: AuditEntry[] }>('/api/admin/audit'),
  properties: (status: 'pending' | 'approved') =>
    api<{ properties: AdminPropertyRow[] }>(`/api/admin/properties?status=${status}`),
  approve: (id: string) => post(`/api/admin/properties/${id}/approve`),
};

export const host = {
  properties: () => api<{ properties: PropertySummary[] }>('/api/host/properties'),
  createProperty: (body: { name: string } & PropertyPatch) =>
    post<PropertyDetail>('/api/host/properties', body),
  property: (id: string) => api<PropertyDetail>(`/api/host/properties/${id}`),
  updateProperty: (id: string, body: PropertyPatch) =>
    patch<PropertyDetail>(`/api/host/properties/${id}`, body),
  deleteProperty: (id: string) => remove(`/api/host/properties/${id}`),
  setPropertyAmenities: (id: string, amenities: AmenityEntry[]) =>
    put<{ amenities: AmenityEntry[] }>(`/api/host/properties/${id}/amenities`, { amenities }),
  createUnit: (propertyId: string, name: string) =>
    post<UnitDetail>(`/api/host/properties/${propertyId}/units`, { name }),
  unit: (id: string) => api<UnitDetail>(`/api/host/units/${id}`),
  updateUnit: (id: string, body: UnitPatch) => patch<UnitDetail>(`/api/host/units/${id}`, body),
  deleteUnit: (id: string) => remove(`/api/host/units/${id}`),
  setUnitAmenities: (id: string, amenities: AmenityEntry[]) =>
    put<{ amenities: AmenityEntry[] }>(`/api/host/units/${id}/amenities`, { amenities }),
  setHiddenBlocks: (id: string, blockIds: string[]) =>
    put<{ hiddenBlockIds: string[] }>(`/api/host/units/${id}/hidden-blocks`, { blockIds }),
  createPropertyBlock: (propertyId: string, body: BlockInput) =>
    post<BlockResult>(`/api/host/properties/${propertyId}/blocks`, body),
  createUnitBlock: (unitId: string, body: BlockInput) =>
    post<BlockResult>(`/api/host/units/${unitId}/blocks`, body),
  updateBlock: (id: string, body: Partial<BlockInput>) =>
    patch<BlockResult>(`/api/host/blocks/${id}`, body),
  deleteBlock: (id: string) => remove(`/api/host/blocks/${id}`),
  translations: (id: string) => api<TranslationsView>(`/api/host/blocks/${id}/translations`),
  correctTranslation: (
    id: string,
    language: GuestLanguage,
    body: { revision: number; title: string; body: string },
  ) =>
    put<{ view: TranslationsView; structureWarnings: string[] }>(
      `/api/host/blocks/${id}/translations/${language}`,
      body,
    ),
  retryTranslation: (id: string) =>
    post<{ view: TranslationsView }>(`/api/host/blocks/${id}/translations/retry`),
  qrUrl: (unitId: string, format: 'svg' | 'png') => `/api/host/units/${unitId}/qr?format=${format}`,
};

// --- Catalog (admin) -----------------------------------------------------------------------------

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Destination {
  id: string;
  name: string;
  centre: LatLng;
  radiusKm: number;
  timezone: string;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface DestinationInput {
  name: string;
  centre: LatLng;
  radiusKm: number;
  timezone: string;
}

export interface Staleness {
  status: StalenessStatus;
  staleAt: string | null;
}

export interface CatalogRecordSummary {
  id: string;
  destinationId: string;
  kind: CatalogKind;
  placeCategory: PlaceCategory | null;
  title: string;
  verifiedAt: string | null;
  staleness: Staleness;
  translation: {
    status: TranslationStatus;
    error: TranslationError | null;
    revision: number;
    publishedRevision: number | null;
  };
  /** Local 'YYYY-MM-DDTHH:mm' in the destination's zone; events only. */
  startsAt: string | null;
  endsAt: string | null;
}

/** 'MM-DD' to 'MM-DD'; may wrap the new year. */
export interface Season {
  from: string;
  to: string;
}

export interface OpeningHours {
  /** 1 = Monday … 7 = Sunday. */
  weekday: number;
  opens: string;
  closes: string;
  validFrom: string | null;
  validTo: string | null;
}

export interface PlaceImage {
  url: string;
  source: ImageSource;
  licence: string | null;
  attribution: string | null;
  sourcePageUrl: string | null;
}

export interface CatalogLink {
  label: string;
  url: string;
}

export type FieldSources = Partial<Record<SourceField, string>>;

export interface CatalogRecord extends CatalogRecordSummary {
  destination: { id: string; name: string; timezone: string };
  description: string;
  location: LatLng | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  venueName: string | null;
  transportMode: TransportMode | null;
  links: CatalogLink[];
  travelMinutes: number | null;
  fieldSources: FieldSources;
  /** Null for the seed or a deleted account. */
  verifiedByEmail: string | null;
  seasons: Season[];
  openingHours: OpeningHours[];
  images: PlaceImage[];
  createdAt: string;
  updatedAt: string;
}

interface RecordText {
  title: string;
  description: string;
  fieldSources?: FieldSources;
}

export type CatalogRecordInput =
  | (RecordText & {
      kind: 'place';
      placeCategory: PlaceCategory;
      location: LatLng;
      address?: string | null;
      phone?: string | null;
      websiteUrl?: string | null;
    })
  | (RecordText & {
      kind: 'event';
      startsAt: string;
      endsAt: string;
      location?: LatLng | null;
      venueName?: string | null;
      websiteUrl?: string | null;
    })
  | (RecordText & { kind: 'transport_note'; transportMode: TransportMode; links?: CatalogLink[] })
  | (RecordText & {
      kind: 'day_trip';
      travelMinutes: number;
      location?: LatLng | null;
      websiteUrl?: string | null;
    });

/** Any subset of the record's own fields; never its kind. */
export type CatalogRecordPatch = Partial<{
  title: string;
  description: string;
  placeCategory: PlaceCategory;
  location: LatLng | null;
  address: string | null;
  phone: string | null;
  websiteUrl: string | null;
  venueName: string | null;
  startsAt: string;
  endsAt: string;
  transportMode: TransportMode;
  links: CatalogLink[];
  travelMinutes: number;
  fieldSources: FieldSources;
}>;

export interface CatalogTranslationsView {
  recordId: string;
  revision: number;
  publishedRevision: number | null;
  status: TranslationStatus;
  error: TranslationError | null;
  sourceLanguage: SourceLanguage | null;
  languages: {
    language: GuestLanguage;
    current: { title: string; body: string; origin: TranslationOrigin; updatedAt: string } | null;
  }[];
}

const record = (id: string) => `/api/admin/catalog/records/${id}`;

export const catalog = {
  destinations: () => api<{ destinations: Destination[] }>('/api/admin/destinations'),
  createDestination: (body: DestinationInput) => post<Destination>('/api/admin/destinations', body),
  destination: (id: string) => api<Destination>(`/api/admin/destinations/${id}`),
  updateDestination: (id: string, body: Partial<DestinationInput>) =>
    patch<Destination>(`/api/admin/destinations/${id}`, body),
  deleteDestination: (id: string) => remove(`/api/admin/destinations/${id}`),
  records: (destinationId: string) =>
    api<{ records: CatalogRecordSummary[] }>(`/api/admin/destinations/${destinationId}/records`),
  createRecord: (destinationId: string, body: CatalogRecordInput) =>
    post<CatalogRecord>(`/api/admin/destinations/${destinationId}/records`, body),
  record: (id: string) => api<CatalogRecord>(record(id)),
  updateRecord: (id: string, body: CatalogRecordPatch) => patch<CatalogRecord>(record(id), body),
  deleteRecord: (id: string) => remove(record(id)),
  setSeasons: (id: string, seasons: Season[]) =>
    put<CatalogRecord>(`${record(id)}/seasons`, { seasons }),
  setOpeningHours: (id: string, hours: OpeningHours[]) =>
    put<CatalogRecord>(`${record(id)}/opening-hours`, { hours }),
  setImages: (id: string, images: PlaceImage[]) =>
    put<CatalogRecord>(`${record(id)}/images`, { images }),
  verify: (id: string) => post<CatalogRecord>(`${record(id)}/verify`),
  translations: (id: string) => api<CatalogTranslationsView>(`${record(id)}/translations`),
  retryTranslation: (id: string) =>
    post<{ view: CatalogTranslationsView }>(`${record(id)}/translations/retry`),
};
