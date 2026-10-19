export function Wordmark({ subtitle }: { subtitle?: string }) {
  return (
    <header>
      <h1>Fetivi</h1>
      {subtitle ? <p>{subtitle}</p> : null}
    </header>
  );
}
