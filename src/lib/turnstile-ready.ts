/**
 * Waits until the Turnstile API is available (R-03). next/script loads a
 * given src once: a second <Turnstile> on the same page (login + recovery)
 * never receives onReady/onLoad, so every instance also polls for
 * window.turnstile. Returns a cleanup function; gives up after `timeoutMs`.
 */
export function watchTurnstileReady(
  isAvailable: () => boolean,
  onReady: () => void,
  { intervalMs = 200, timeoutMs = 30_000 } = {},
): () => void {
  if (isAvailable()) {
    onReady();
    return () => {};
  }
  const started = Date.now();
  const timer = setInterval(() => {
    if (isAvailable()) {
      clearInterval(timer);
      onReady();
    } else if (Date.now() - started >= timeoutMs) clearInterval(timer);
  }, intervalMs);
  return () => clearInterval(timer);
}
