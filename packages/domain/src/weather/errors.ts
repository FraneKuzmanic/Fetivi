/** A feed could not be fetched or read: a bad status, a network error, or a body that does not parse. */
export class WeatherFeedError extends Error {
  override name = 'WeatherFeedError';
}

/** Every weather part failed: no forecast, sea, UV or warnings to report. */
export class WeatherUnavailableError extends Error {
  override name = 'WeatherUnavailableError';
}
