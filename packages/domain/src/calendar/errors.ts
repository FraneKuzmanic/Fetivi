export class CalendarRuleError extends Error {
  override name = 'CalendarRuleError';
  constructor(
    readonly code:
      | 'not-found'
      | 'invalid-calendar-url'
      | 'calendar-exists'
      | 'too-many-calendars'
      | 'proposal-gone'
      | 'not-possibly-cancelled',
  ) {
    super(code);
  }
}

/** A feed that could not be read. Recorded on the feed; its events are left untouched. */
export class CalendarFeedError extends Error {
  override name = 'CalendarFeedError';
  constructor(
    readonly code: 'fetch-failed' | 'http-error' | 'too-large' | 'not-a-calendar',
    readonly status?: number,
  ) {
    super(code);
  }

  /** The value stored in `calendar_feeds.last_error`. */
  get stored(): string {
    return this.code === 'http-error' ? `http-${this.status}` : this.code;
  }
}
