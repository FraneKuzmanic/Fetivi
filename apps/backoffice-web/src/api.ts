import type { CalendarSource } from '@fetivi/domain/calendar-vocabulary';
import type {
  CatalogKind,
  ImageSource,
  PlaceCategory,
  SourceField,
  StalenessStatus,
  TransportMode,
} from '@fetivi/domain/catalog-vocabulary';
import type {
  CurationAction,
  CurationKind,
  CurationPayload,
  CurationStatus,
  CurationTab,
} from '@fetivi/domain/curation-vocabulary';
import type {
  HandoffReason,
  HandoffTranslationState,
  HandoffUrgency,
} from '@fetivi/domain/handoff-vocabulary';
import type { HostDeliveryMode } from '@fetivi/domain/host-notification-vocabulary';
import type {
  AdapterKind,
  AvailabilityMode,
  ContactFields,
  OfferCategory,
  OrderKind,
  PaymentMode,
  PriceUnit,
  ProviderLanguage,
} from '@fetivi/domain/offer-vocabulary';
import type {
  OrderStatus,
  OrderTrigger,
  PaymentStatus,
  Proposer,
} from '@fetivi/domain/order-vocabulary';
import type {
  FindingKind,
  FindingStatus,
  ProviderCardStatus,
  ReconcileError,
  ReconcileTrigger,
} from '@fetivi/domain/payments-vocabulary';
import type {
  Amenity,
  Bed,
  BlockCategory,
  BlockVisibility,
  CheckInMethod,
  DraftStatus,
  GuestLanguage,
  HostBlockCategory,
  ManualSource,
  MediaKind,
  ParkingType,
  PropertyType,
  SourceLanguage,
  TranslationError,
  TranslationOrigin,
  TranslationStatus,
} from '@fetivi/domain/vocabulary';
import type {
  GoLiveItem,
  WizardFieldId,
  WizardLevel,
  WizardProgress,
  WizardPromptKey,
  WizardStepId,
} from '@fetivi/domain/wizard';

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

/** Sends a file as the raw request body, typed by its own content type. */
export async function upload<T>(path: string, file: File): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': file.type || 'application/octet-stream' },
    body: file,
    credentials: 'same-origin',
  });
  const json = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new ApiError(response.status, json?.error ?? 'internal');
  return json as T;
}

export interface Me {
  account: { id: string; email: string; role: 'host' | 'admin'; language: GuestLanguage };
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
  /** The setup-wizard prompt the block answers, if any. */
  wizardKey: WizardPromptKey | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  media: BlockMedia[];
}

/** A photo or short video on a block. */
export interface BlockMedia {
  id: string;
  kind: MediaKind;
  contentType: string;
  bytes: number;
  caption: string;
  addedRevision: number;
  position: number;
  createdAt: string;
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
  /** Create only. */
  wizardKey?: WizardPromptKey | null;
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
  units: { id: string; name: string; hasQr: boolean; live: boolean }[];
}

export interface PropertyDetail extends CoreValues {
  id: string;
  name: string;
  propertyType: PropertyType | null;
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
  /** Has its QR slug: approved and the go-live minimum was met. */
  live: boolean;
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

/** GET /api/host/units/:id/wizard. */
export interface WizardStatus {
  unitId: string;
  propertyId: string;
  unitName: string;
  propertyName: string;
  propertyType: PropertyType | null;
  approved: boolean;
  live: boolean;
  /** Visible fields only. */
  fields: Partial<Record<WizardFieldId, { level: WizardLevel; filled: boolean }>>;
  progress: WizardProgress;
  resumeStep: WizardStepId | null;
  goLive: { ready: boolean; missing: GoLiveItem[] };
}

/** Every column a manual draft can fill, by name; the values are the API's own types. */
export type ManualDraftValues = Partial<
  Pick<PropertyDetail, 'addressLine' | 'city' | 'postalCode' | 'buildingDoorCode'> &
    Pick<
      UnitDetail,
      | keyof CoreValues
      | 'noWifi'
      | 'wifiNetwork'
      | 'wifiPassword'
      | 'doorCode'
      | 'lockboxCode'
      | 'maxOccupancy'
      | 'bedrooms'
      | 'bathrooms'
      | 'beds'
    >
>;
export type ManualDraftColumn = keyof ManualDraftValues;

/** One draft of a house manual import; mirrors the domain's ManualDraftItem. */
export type ManualDraftItem = { id: string; status: DraftStatus } & (
  | { kind: 'field'; fieldId: WizardFieldId; values: ManualDraftValues }
  | { kind: 'amenities'; amenities: AmenityEntry[] }
  | {
      kind: 'block';
      category: HostBlockCategory;
      wizardKey: WizardPromptKey | null;
      title: string;
      body: string;
      scrubbed: boolean;
      warnings: SecretWarning[];
    }
  | { kind: 'unmapped'; text: string; fieldId: WizardFieldId | null }
);

export interface ManualImport {
  id: string;
  source: ManualSource;
  createdAt: string;
  items: ManualDraftItem[];
}

export type ConfirmBody =
  | { values: ManualDraftValues }
  | { amenities: AmenityEntry[] }
  | { title: string; body: string }
  | { category: HostBlockCategory; title: string; body: string };

const MANUAL_EXTENSION_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
};

/** Some browsers give no type for .txt or .docx files; the extension decides then. */
function typedManualFile(file: File): File {
  if (file.type) return file;
  const type = MANUAL_EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return type ? new File([file], file.name, { type }) : file;
}

export type StayPhase = 'upcoming' | 'in_stay' | 'ended';

export interface Stay {
  id: string;
  unitId: string;
  unitName: string;
  propertyId: string;
  propertyName: string;
  timezone: string;
  /** Civil dates, 'YYYY-MM-DD'. */
  checkIn: string;
  checkout: string;
  partySize: number;
  bookerName: string | null;
  reservationNumber: string | null;
  pin: string;
  arrivalReleaseAt: string;
  /** 'YYYY-MM-DDTHH:mm' in the property's zone. */
  arrivalReleaseLocal: string;
  activeUntil: string;
  possiblyCancelled: boolean;
  /** The calendars this Stay was registered from or linked to; empty for a manual Stay. */
  calendarSources: CalendarSource[];
  pinSentAt: string | null;
  handoverLanguage: GuestLanguage;
  /** The unit's permanent link; never contains the PIN. */
  unitLink: string | null;
  phase: StayPhase;
  pinWarning: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface StayInput {
  checkIn: string;
  checkout: string;
  partySize: number;
  bookerName?: string | null;
  reservationNumber?: string | null;
  handoverLanguage?: GuestLanguage;
}

export type StayPatch = Partial<StayInput> & { pinSent?: boolean };

/** A unit's calendar link; the URL itself is never sent back (its query is the export secret). */
export interface CalendarFeed {
  id: string;
  unitId: string;
  source: CalendarSource;
  /** Host and path only. */
  label: string;
  lastPolledAt: string | null;
  lastOkAt: string | null;
  /** 'fetch-failed' | 'http-<status>' | 'too-large' | 'not-a-calendar'. */
  lastError: string | null;
  createdAt: string;
}

export interface UnitCalendars {
  feeds: CalendarFeed[];
  bookingLinks: { needed: boolean; approvedAt: string | null; domain: string; propertyId: string };
}

/** One or more calendar events with identical dates on a unit, awaiting Confirm or Not a booking. */
export interface StayProposal {
  id: string;
  unitId: string;
  unitName: string;
  propertyId: string;
  propertyName: string;
  timezone: string;
  checkIn: string;
  checkout: string;
  sources: CalendarSource[];
  summaries: { source: CalendarSource; summary: string }[];
  pinWarning: boolean;
}

export interface StayProposals {
  proposals: StayProposal[];
  bookingLinks: { domain: string; pending: { propertyId: string; propertyName: string }[] };
}

export type ProposalConfirm = Omit<StayInput, 'checkIn' | 'checkout'>;

export interface ReconciliationRun {
  id: string;
  trigger: ReconcileTrigger;
  startedAt: string;
  /** Null while running, or when the run did not finish. */
  finishedAt: string | null;
  checked: number;
  found: number;
  resolved: number;
  /** Why only the holds were checked. */
  error: ReconcileError | null;
}

export interface ReconciliationFinding {
  id: string;
  kind: FindingKind;
  status: FindingStatus;
  orderId: string | null;
  stripeRef: string | null;
  detail: string;
  action: string | null;
  firstSeenAt: string;
  lastSeenAt: string;
  resolvedAt: string | null;
}

export interface AdminOrderEvent {
  id: number;
  at: string;
  /** Null on creation. */
  from: OrderStatus | null;
  to: OrderStatus;
  fromPayment: PaymentStatus | null;
  toPayment: PaymentStatus;
  trigger: OrderTrigger;
  note: string | null;
  /** The admin who acted, for admin actions. */
  actorEmail: string | null;
}

/** One Order on the admin page, with what the admin may still do. */
export interface AdminOrder {
  id: string;
  status: OrderStatus;
  paymentStatus: PaymentStatus;
  paymentMode: PaymentMode;
  availabilityMode: AvailabilityMode;
  offerTitle: string;
  providerName: string | null;
  /** A host's own Offer: the host is paid and is merchant of record. */
  hostEmail: string | null;
  date: string;
  startsAt: string | null;
  quantity: number;
  priceMinor: number | null;
  currency: string;
  cancellationPolicy: string;
  freeCancelHoursBefore: number;
  refundPercentAfter: number;
  /** What the snapshotted rules would refund on a cancel now; null with nothing captured. */
  policyRefundMinor: number | null;
  /** The captured amount, when a cancel refunds money and an override applies. */
  paidAmountMinor: number | null;
  /** The refund decided on the attempt; null until one is. */
  refundAmountMinor: number | null;
  /** The current proposal: answers are bound to it. */
  proposalId: string;
  proposer: Proposer;
  version: number;
  orderKind: OrderKind;
  /** When the Provider's on-request answer is due; null when it was never asked. */
  responseDueAt: string | null;
  windowMissed: boolean;
  /** The Order waits for the Provider, so the admin may record a phoned answer. */
  canAnswer: boolean;
  stayFrom: string;
  stayTo: string;
  /** The zone a new time is entered in. */
  zone: string;
  canCancel: boolean;
  canRefund: boolean;
  events: AdminOrderEvent[];
}

export interface AdminPropertyRow {
  id: string;
  name: string;
  city: string | null;
  hostEmail: string;
  unitCount: number;
  createdAt: string;
  approvedAt: string | null;
}

/** A Host message in the host's inbox: only what a guest chose to send. */
export interface HostMessage {
  id: string;
  unitName: string;
  propertyName: string;
  checkIn: string;
  checkout: string;
  bookerName: string | null;
  guestLanguage: GuestLanguage;
  hostLanguage: GuestLanguage;
  reason: HandoffReason;
  urgency: HandoffUrgency;
  /** What the guest wrote, in their language. */
  text: string;
  /** In the host's language; null until done, or when not needed. */
  translation: string | null;
  translationState: HandoffTranslationState;
  sentAt: string;
  readAt: string | null;
  reply: {
    text: string;
    repliedAt: string;
    translationState: HandoffTranslationState | null;
    deliveredAt: string | null;
  } | null;
}

/** The host's notification settings and the phone alerts state of the signed-in account. */
export interface HostNotificationSettings {
  mode: HostDeliveryMode;
  digestTimes: string[];
  /** The clock the digest times are read in: the host's oldest property's time zone. */
  timezone: string;
  push: { publicKey: string | null; devices: number };
}

/** `PushSubscription.toJSON()`. */
export interface HostPushSubscription {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** A one-tap answer on an Order of the host's own service: the Provider link's actions (38). */
export type OrderAction =
  | 'acknowledge'
  | 'cannot_fulfil'
  | 'accept'
  | 'decline'
  | 'suggest_time'
  | 'accept_with_price';

/** An Order as the Provider link shows it; the host sees the same for their own services. */
export interface HostOrderView {
  orderId: string;
  proposalId: string;
  offerTitle: string;
  /** 'YYYY-MM-DD'. */
  date: string;
  /** 'HH:mm' in the Offer's zone; null without a start time. */
  startTime: string | null;
  quantity: number;
  priceUnit: PriceUnit;
  /** Only what the Offer shares; empty once the Order is final. */
  guest: { name?: string; phone?: string };
  status: OrderStatus;
  final: boolean;
  acknowledgedAt: string | null;
  actions: OrderAction[];
  /** The proposal's total; null for a request before it is priced. */
  priceMinor: number | null;
  currency: string;
  /** 'YYYY-MM-DDTHH:mm' when the answer is due; null otherwise. */
  respondBy: string | null;
  stayFrom: string;
  stayTo: string;
  /** New terms must carry a price. */
  needsPrice: boolean;
}

export interface HostOrder extends HostOrderView {
  offerId: string;
  createdAt: string;
  /** Something is asked of the host. */
  waiting: boolean;
}

export interface HostOrderActionBody {
  action: OrderAction;
  proposalId: string;
  date?: string;
  time?: string;
  priceMinor?: number;
}

/** An approved Provider near the host's properties, and whether the host hides it (38). */
export interface HostProvider {
  id: string;
  name: string;
  offerCount: number;
  destinations: string[];
  hidden: boolean;
}

export interface ProviderSuggestion {
  name: string;
  contact?: string | null;
  note?: string | null;
  destinationId?: string | null;
}

/** A Stripe connected account's state, for a Provider or a host. */
export interface PaymentsStatus {
  stripeConnected: boolean;
  /** Stripe's card capability, as last read; null until onboarding starts. */
  stripeCardPayments: ProviderCardStatus | null;
  stripeCheckedAt: string | null;
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
  setLanguage: (language: GuestLanguage) => put<Me>('/api/auth/me/language', { language }),
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

export const adminOrders = {
  get: (id: string) => api<AdminOrder>(`/api/admin/orders/${encodeURIComponent(id)}`),
  cancel: (id: string, body: { refundMinor?: number; note?: string }) =>
    post<AdminOrder>(`/api/admin/orders/${encodeURIComponent(id)}/cancel`, body),
  refund: (id: string, body: { refundMinor: number; note?: string }) =>
    post<AdminOrder>(`/api/admin/orders/${encodeURIComponent(id)}/refund`, body),
  accept: (id: string, body: { proposalId: string; note: string }) =>
    post<AdminOrder>(`/api/admin/orders/${encodeURIComponent(id)}/accept`, body),
  decline: (id: string, body: { proposalId: string; note: string }) =>
    post<AdminOrder>(`/api/admin/orders/${encodeURIComponent(id)}/decline`, body),
  propose: (
    id: string,
    body: { proposalId: string; note: string; date: string; time?: string; priceMinor?: number },
  ) => post<AdminOrder>(`/api/admin/orders/${encodeURIComponent(id)}/propose`, body),
};

export const reconciliation = {
  list: (status: 'needs_attention' | 'resolved') =>
    api<{ runs: ReconciliationRun[]; findings: ReconciliationFinding[] }>(
      `/api/admin/reconciliation?status=${status}`,
    ),
  run: () => post<{ queued: true }>('/api/admin/reconciliation/run'),
  resolve: (id: string) => post(`/api/admin/reconciliation/findings/${id}/resolve`),
};

export interface CurationItem {
  id: string;
  kind: CurationKind;
  status: CurationStatus;
  payload: CurationPayload;
  destination: { id: string; name: string } | null;
  host: { id: string; email: string } | null;
  record: {
    id: string;
    title: string;
    kind: CatalogKind;
    placeCategory: PlaceCategory | null;
    verifiedAt: string | null;
  } | null;
  /** Empty once the item is approved or rejected. */
  actions: CurationAction[];
  createdAt: string;
  reviewedAt: string | null;
}

export interface StalenessRecord {
  id: string;
  destinationId: string;
  destinationName: string;
  kind: CatalogKind;
  placeCategory: PlaceCategory | null;
  title: string;
  verifiedAt: string | null;
  staleness: Staleness;
  /** In the last RECOMMENDATION_WINDOW_DAYS days. */
  recommendations: number;
  score: number;
}

export const curation = {
  list: (filter: { status: CurationTab; kind?: CurationKind; destinationId?: string }) => {
    const query = new URLSearchParams({ status: filter.status });
    if (filter.kind) query.set('kind', filter.kind);
    if (filter.destinationId) query.set('destinationId', filter.destinationId);
    return api<{ items: CurationItem[]; counts: Record<CurationKind, number> }>(
      `/api/admin/curation?${query}`,
    );
  },
  approve: (id: string) => post<CurationItem>(`/api/admin/curation/${id}/approve`),
  edit: (id: string) => post<{ recordId: string }>(`/api/admin/curation/${id}/edit`),
  reject: (id: string) => post(`/api/admin/curation/${id}/reject`),
  needsVisit: (id: string) => post(`/api/admin/curation/${id}/needs-visit`),
  staleness: (destinationId?: string) =>
    api<{ records: StalenessRecord[] }>(
      destinationId
        ? `/api/admin/curation/staleness?${new URLSearchParams({ destinationId })}`
        : '/api/admin/curation/staleness',
    ),
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
  uploadMedia: (blockId: string, file: File, caption: string) =>
    upload<{ media: BlockMedia; block: Block }>(
      `/api/host/blocks/${blockId}/media?caption=${encodeURIComponent(caption)}`,
      file,
    ),
  updateMediaCaption: (id: string, caption: string) =>
    patch<{ media: BlockMedia; block: Block }>(`/api/host/media/${id}`, { caption }),
  deleteMedia: (id: string) => remove(`/api/host/media/${id}`),
  mediaUrl: (id: string) => `/api/host/media/${id}`,
  wizard: (id: string) => api<WizardStatus>(`/api/host/units/${id}/wizard`),
  goLive: (id: string) => post<WizardStatus>(`/api/host/units/${id}/go-live`),
  manualImport: (unitId: string) =>
    api<{ import: ManualImport | null }>(`/api/host/units/${unitId}/manual-import`),
  pasteManual: (unitId: string, text: string) =>
    post<{ import: ManualImport }>(`/api/host/units/${unitId}/manual-import`, { text }),
  uploadManual: (unitId: string, file: File) =>
    upload<{ import: ManualImport }>(
      `/api/host/units/${unitId}/manual-import`,
      typedManualFile(file),
    ),
  confirmDraft: (unitId: string, itemId: string, body: ConfirmBody) =>
    post<{ import: ManualImport; warnings: SecretWarning[] }>(
      `/api/host/units/${unitId}/manual-import/items/${itemId}/confirm`,
      body,
    ),
  dismissDraft: (unitId: string, itemId: string) =>
    post<{ import: ManualImport }>(
      `/api/host/units/${unitId}/manual-import/items/${itemId}/dismiss`,
    ),
  qrUrl: (unitId: string, format: 'svg' | 'png') => `/api/host/units/${unitId}/qr?format=${format}`,
  stays: (params: { unitId?: string; past?: boolean } = {}) => {
    const query = new URLSearchParams();
    if (params.unitId) query.set('unitId', params.unitId);
    if (params.past) query.set('past', 'true');
    const search = query.toString();
    return api<{ stays: Stay[] }>(`/api/host/stays${search ? `?${search}` : ''}`);
  },
  stay: (id: string) => api<Stay>(`/api/host/stays/${id}`),
  createStay: (unitId: string, body: StayInput) =>
    post<Stay>(`/api/host/units/${unitId}/stays`, body),
  updateStay: (id: string, body: StayPatch) => patch<Stay>(`/api/host/stays/${id}`, body),
  deleteStay: (id: string) => remove(`/api/host/stays/${id}`),
  keepStay: (id: string) => post<Stay>(`/api/host/stays/${id}/keep`),
  calendars: (unitId: string) => api<UnitCalendars>(`/api/host/units/${unitId}/calendars`),
  addCalendar: (unitId: string, url: string) =>
    post<CalendarFeed>(`/api/host/units/${unitId}/calendars`, { url }),
  removeCalendar: (id: string) => remove(`/api/host/calendars/${id}`),
  stayProposals: (unitId?: string) =>
    api<StayProposals>(
      `/api/host/stay-proposals${unitId ? `?unitId=${encodeURIComponent(unitId)}` : ''}`,
    ),
  confirmProposal: (id: string, body: ProposalConfirm) =>
    post<Stay>(`/api/host/stay-proposals/${id}/confirm`, body),
  dismissProposal: (id: string) => post(`/api/host/stay-proposals/${id}/dismiss`),
  approveBookingLinks: (propertyId: string) =>
    post(`/api/host/properties/${propertyId}/booking-links-approved`),
  inbox: () =>
    api<{ messages: HostMessage[]; unread: number; orders: HostOrder[]; ordersWaiting: number }>(
      '/api/host/inbox',
    ),
  order: (id: string) => api<{ order: HostOrderView }>(`/api/host/orders/${id}`),
  orderAction: (id: string, body: HostOrderActionBody) =>
    post<{ outcome: 'applied' | 'unchanged' | 'stale' | 'rejected'; order: HostOrderView }>(
      `/api/host/orders/${id}/actions`,
      body,
    ),
  offers: () => api<{ offers: OfferSummary[] }>('/api/host/offers'),
  createOffer: (body: HostOfferInput) => post<Offer>('/api/host/offers', body),
  offer: (id: string) => api<Offer>(`/api/host/offers/${id}`),
  updateOffer: (id: string, body: HostOfferPatch) => patch<Offer>(`/api/host/offers/${id}`, body),
  deleteOffer: (id: string) => remove(`/api/host/offers/${id}`),
  slots: (offerId: string, past = false) =>
    api<{ timezone: string; slots: AllotmentSlot[] }>(
      `/api/host/offers/${offerId}/slots${past ? '?past=true' : ''}`,
    ),
  bulkSlots: (offerId: string, body: SlotsBulkInput) =>
    post<{ created: number; skipped: number }>(`/api/host/offers/${offerId}/slots/bulk`, body),
  setSlotCapacity: (slotId: string, capacity: number) =>
    patch<AllotmentSlot>(`/api/host/allotment-slots/${slotId}`, { capacity }),
  deleteSlot: (slotId: string) => remove(`/api/host/allotment-slots/${slotId}`),
  offerTranslations: (id: string) =>
    api<OfferTranslationsView>(`/api/host/offers/${id}/translations`),
  retryOfferTranslation: (id: string) =>
    post<{ view: OfferTranslationsView }>(`/api/host/offers/${id}/translations/retry`),
  providers: () =>
    api<{ providers: HostProvider[]; destinations: { id: string; name: string }[] }>(
      '/api/host/providers',
    ),
  setProviderHidden: (id: string, hidden: boolean) =>
    put<HostProvider>(`/api/host/providers/${id}/hidden`, { hidden }),
  suggestProvider: (body: ProviderSuggestion) =>
    post<{ id: string }>('/api/host/provider-suggestions', body),
  payments: () => api<PaymentsStatus>('/api/host/payments'),
  paymentsLink: () =>
    post<{ url: string; expiresAt: string }>('/api/host/payments/stripe/onboarding-link'),
  paymentsRefresh: () => post<PaymentsStatus>('/api/host/payments/stripe/refresh'),
  readMessage: (id: string) => post(`/api/host/inbox/${id}/read`),
  replyMessage: (id: string, text: string) =>
    post<{ message: HostMessage }>(`/api/host/inbox/${id}/reply`, { text }),
  notificationSettings: () => api<HostNotificationSettings>('/api/host/notification-settings'),
  saveNotificationSettings: (body: { mode: HostDeliveryMode; digestTimes: string[] }) =>
    put<HostNotificationSettings>('/api/host/notification-settings', body),
  subscribePush: (subscription: HostPushSubscription) =>
    post('/api/host/push/subscription', subscription),
  unsubscribePush: (endpoint: string) =>
    api<void>('/api/host/push/subscription', { method: 'DELETE', body: { endpoint } }),
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
  /** FERRY_LINES ids a day trip or transport note depends on (safety alerts). */
  ferryLines: string[];
  /** Places and day trips: daily tips suggest it when rain is forecast. */
  rainyDay: boolean;
  /** Events: About me interest codes the event suits (daily tips). */
  interests: string[];
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
      rainyDay?: boolean;
    })
  | (RecordText & {
      kind: 'event';
      startsAt: string;
      endsAt: string;
      location?: LatLng | null;
      venueName?: string | null;
      websiteUrl?: string | null;
      interests?: string[];
    })
  | (RecordText & {
      kind: 'transport_note';
      transportMode: TransportMode;
      links?: CatalogLink[];
      ferryLines?: string[];
    })
  | (RecordText & {
      kind: 'day_trip';
      travelMinutes: number;
      ferryLines?: string[];
      location?: LatLng | null;
      websiteUrl?: string | null;
      rainyDay?: boolean;
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
  ferryLines: string[];
  rainyDay: boolean;
  interests: string[];
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

// --- Providers and Offers (admin) ----------------------------------------------------------------

export interface Provider {
  id: string;
  name: string;
  email: string;
  whatsappPhone: string | null;
  language: ProviderLanguage;
  taxNumber: string | null;
  /** Basis points: 1250 = 12.5 %. */
  commissionBp: number;
  dealNotes: string | null;
  stripeConnected: boolean;
  /** Stripe's card capability, as last read; null until onboarding starts. */
  stripeCardPayments: ProviderCardStatus | null;
  stripeCheckedAt: string | null;
  active: boolean;
  offerCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProviderInput {
  name: string;
  email: string;
  whatsappPhone?: string | null;
  language?: ProviderLanguage;
  taxNumber?: string | null;
  commissionBp?: number;
  dealNotes?: string | null;
  active?: boolean;
}

export interface OfferSummary {
  id: string;
  providerId: string | null;
  destination: { id: string; name: string } | null;
  title: string;
  category: OfferCategory;
  orderKind: OrderKind;
  availabilityMode: AvailabilityMode;
  paymentMode: PaymentMode;
  /** Cents; null only for requests. */
  priceMinor: number | null;
  currency: string;
  priceUnit: PriceUnit;
  active: boolean;
  translation: {
    status: TranslationStatus;
    error: TranslationError | null;
    revision: number;
    publishedRevision: number | null;
  };
}

export interface Offer extends OfferSummary {
  provider: { id: string; name: string } | null;
  /** The zone slot times and response hours are in. */
  timezone: string;
  description: string;
  cancellationPolicy: string;
  placeId: string | null;
  place: { id: string; title: string } | null;
  freeCancelHoursBefore: number;
  refundPercentAfter: number;
  responseWindowMinutes: number;
  /** 'HH:MM'. */
  responseHoursFrom: string;
  responseHoursTo: string;
  contactFields: ContactFields;
  adapterKind: AdapterKind | null;
  externalProductRef: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface OfferFields {
  placeId: string | null;
  title: string;
  description: string;
  cancellationPolicy: string;
  category: OfferCategory;
  orderKind: OrderKind;
  availabilityMode: AvailabilityMode;
  paymentMode: PaymentMode;
  priceMinor: number | null;
  currency: string;
  priceUnit: PriceUnit;
  freeCancelHoursBefore: number;
  refundPercentAfter: number;
  responseWindowMinutes: number;
  responseHoursFrom: string;
  responseHoursTo: string;
  contactFields: ContactFields;
  adapterKind: AdapterKind | null;
  externalProductRef: string | null;
  active: boolean;
}

/** A create: the destination and the required fields; the API defaults the rest. */
export type OfferInput = Partial<OfferFields> &
  Pick<
    OfferFields,
    | 'title'
    | 'description'
    | 'cancellationPolicy'
    | 'category'
    | 'orderKind'
    | 'availabilityMode'
    | 'paymentMode'
    | 'priceMinor'
  > & { destinationId: string };

/** Any subset of the Offer's own fields; never its destination or owner. */
export type OfferPatch = Partial<OfferFields>;

/** A host's own service (38): no place or live mode, and no destination. */
export type HostOfferFields = Omit<
  OfferFields,
  'placeId' | 'adapterKind' | 'externalProductRef' | 'availabilityMode'
> & { availabilityMode: Exclude<AvailabilityMode, 'live'> };

export type HostOfferInput = Partial<HostOfferFields> &
  Pick<
    HostOfferFields,
    | 'title'
    | 'description'
    | 'cancellationPolicy'
    | 'category'
    | 'orderKind'
    | 'availabilityMode'
    | 'paymentMode'
    | 'priceMinor'
  >;

export type HostOfferPatch = Partial<HostOfferFields>;

export interface AllotmentSlot {
  id: string;
  /** Local 'YYYY-MM-DDTHH:mm' in the Offer's zone. */
  startsAt: string;
  capacity: number;
  remaining: number;
}

export interface SlotsBulkInput {
  from: string;
  to: string;
  weekdays: number[];
  times: string[];
  capacity: number;
}

export interface OfferTranslationsView {
  offerId: string;
  revision: number;
  publishedRevision: number | null;
  status: TranslationStatus;
  error: TranslationError | null;
  sourceLanguage: SourceLanguage | null;
  languages: {
    language: GuestLanguage;
    current: {
      title: string;
      body: string;
      cancellationPolicy: string;
      origin: TranslationOrigin;
      updatedAt: string;
    } | null;
  }[];
}

/** What the slots panel calls: the admin's or the host's Offer routes. */
export interface SlotsClient {
  slots: (offerId: string, past?: boolean) => Promise<{ timezone: string; slots: AllotmentSlot[] }>;
  bulkSlots: (
    offerId: string,
    body: SlotsBulkInput,
  ) => Promise<{ created: number; skipped: number }>;
  setSlotCapacity: (slotId: string, capacity: number) => Promise<AllotmentSlot>;
  deleteSlot: (slotId: string) => Promise<void>;
}

/** What the Offer translations panel calls. */
export interface OfferTranslationsClient {
  translations: (id: string) => Promise<OfferTranslationsView>;
  retryTranslation: (id: string) => Promise<{ view: OfferTranslationsView }>;
}

const providerPath = (id: string) => `/api/admin/providers/${id}`;
const offerPath = (id: string) => `/api/admin/offers/${id}`;

export const providers = {
  list: () => api<{ providers: Provider[] }>('/api/admin/providers'),
  create: (body: ProviderInput) => post<Provider>('/api/admin/providers', body),
  get: (id: string) => api<Provider>(providerPath(id)),
  update: (id: string, body: Partial<ProviderInput>) => patch<Provider>(providerPath(id), body),
  remove: (id: string) => remove(providerPath(id)),
  /** A fresh Stripe onboarding link; creates the connected account on the first call. */
  stripeOnboardingLink: (id: string) =>
    post<{ url: string; expiresAt: string }>(`${providerPath(id)}/stripe/onboarding-link`),
  /** Reads the card capability from Stripe and stores it. */
  stripeRefresh: (id: string) => post<Provider>(`${providerPath(id)}/stripe/refresh`),
  offers: (providerId: string) =>
    api<{ offers: OfferSummary[] }>(`${providerPath(providerId)}/offers`),
  createOffer: (providerId: string, body: OfferInput) =>
    post<Offer>(`${providerPath(providerId)}/offers`, body),
  offer: (id: string) => api<Offer>(offerPath(id)),
  updateOffer: (id: string, body: OfferPatch) => patch<Offer>(offerPath(id), body),
  deleteOffer: (id: string) => remove(offerPath(id)),
  slots: (offerId: string, past = false) =>
    api<{ timezone: string; slots: AllotmentSlot[] }>(
      `${offerPath(offerId)}/slots${past ? '?past=true' : ''}`,
    ),
  bulkSlots: (offerId: string, body: SlotsBulkInput) =>
    post<{ created: number; skipped: number }>(`${offerPath(offerId)}/slots/bulk`, body),
  setSlotCapacity: (slotId: string, capacity: number) =>
    patch<AllotmentSlot>(`/api/admin/allotment-slots/${slotId}`, { capacity }),
  deleteSlot: (slotId: string) => remove(`/api/admin/allotment-slots/${slotId}`),
  translations: (id: string) => api<OfferTranslationsView>(`${offerPath(id)}/translations`),
  retryTranslation: (id: string) =>
    post<{ view: OfferTranslationsView }>(`${offerPath(id)}/translations/retry`),
};
