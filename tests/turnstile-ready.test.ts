import { afterEach, describe, expect, it, vi } from "vitest";
import { watchTurnstileReady } from "../src/lib/turnstile-ready";

afterEach(() => vi.useRealTimers());

describe("watchTurnstileReady (R-03)", () => {
  it("marca listo de inmediato si la API ya está cargada", () => {
    const onReady = vi.fn();
    watchTurnstileReady(() => true, onReady);
    expect(onReady).toHaveBeenCalledOnce();
  });
  it("una segunda instancia sin onReady se dibuja cuando aparece la API", () => {
    vi.useFakeTimers();
    let available = false;
    const first = vi.fn();
    const second = vi.fn();
    watchTurnstileReady(() => available, first);
    watchTurnstileReady(() => available, second);
    vi.advanceTimersByTime(1000);
    expect(first).not.toHaveBeenCalled();
    available = true;
    vi.advanceTimersByTime(200);
    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(second).toHaveBeenCalledOnce();
  });
  it("se detiene al desmontar y tras el tiempo máximo", () => {
    vi.useFakeTimers();
    let available = false;
    const unmounted = vi.fn();
    const stop = watchTurnstileReady(() => available, unmounted);
    stop();
    const late = vi.fn();
    watchTurnstileReady(() => available, late, { timeoutMs: 1000 });
    vi.advanceTimersByTime(1200);
    available = true;
    vi.advanceTimersByTime(1000);
    expect(unmounted).not.toHaveBeenCalled();
    expect(late).not.toHaveBeenCalled();
  });
});
