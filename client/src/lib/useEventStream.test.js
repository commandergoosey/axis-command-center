import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import useEventStream from './useEventStream.js';

// ── Fake EventSource ──────────────────────────────────────────────────
// Tracks all instances created during a test so we can inspect URLs,
// fire events, and trigger reconnect paths.

class FakeEventSource {
  constructor(url) {
    this.url      = url;
    this.closed   = false;
    this.onerror  = null;
    this._listeners = {};
    FakeEventSource.instances.push(this);
  }

  addEventListener(type, fn) {
    if (!this._listeners[type]) this._listeners[type] = [];
    this._listeners[type].push(fn);
  }

  // Fire a named event at all registered handlers
  fire(type, data) {
    const handlers = this._listeners[type] ?? [];
    const event = { data: JSON.stringify(data), type };
    for (const h of handlers) h(event);
  }

  // Simulate a connection error / drop
  triggerError() {
    if (this.onerror) this.onerror({});
  }

  close() {
    this.closed = true;
  }
}

function makeLocalStorageStub() {
  let store = {};
  return {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { store = {}; },
  };
}

const TOKEN_KEY = 'axis.auth.token';

describe('useEventStream', () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
    vi.useFakeTimers();
    vi.stubGlobal('EventSource', FakeEventSource);
    vi.stubGlobal('localStorage', makeLocalStorageStub());
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  // ── Connection gating ───────────────────────────────────────────────

  it('does not connect when enabled=false', () => {
    renderHook(() => useEventStream({ enabled: false, onAlert: vi.fn() }));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('does not connect when no token is stored', () => {
    // No token in localStorage
    renderHook(() => useEventStream({ onAlert: vi.fn() }));
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  it('connects when a token is stored', () => {
    localStorage.setItem(TOKEN_KEY, 'tok-abc');
    renderHook(() => useEventStream({ onAlert: vi.fn() }));
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it('includes token as query param in the SSE URL', () => {
    localStorage.setItem(TOKEN_KEY, 'my-token');
    renderHook(() => useEventStream({ onAlert: vi.fn() }));
    expect(FakeEventSource.instances[0].url).toContain('token=my-token');
    expect(FakeEventSource.instances[0].url).toContain('/api/events/stream');
  });

  // ── Event routing ───────────────────────────────────────────────────

  it('calls onTripStarted when trip_started event fires', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const onTripStarted = vi.fn();
    renderHook(() => useEventStream({ onTripStarted }));
    act(() => FakeEventSource.instances[0].fire('trip_started', { trip_id: 't1' }));
    expect(onTripStarted).toHaveBeenCalledWith({ trip_id: 't1' });
  });

  it('calls onTripCompleted when trip_completed event fires', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const onTripCompleted = vi.fn();
    renderHook(() => useEventStream({ onTripCompleted }));
    act(() => FakeEventSource.instances[0].fire('trip_completed', { trip_id: 't2' }));
    expect(onTripCompleted).toHaveBeenCalledWith({ trip_id: 't2' });
  });

  it('calls onPosition when position_update event fires', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const onPosition = vi.fn();
    renderHook(() => useEventStream({ onPosition }));
    act(() => FakeEventSource.instances[0].fire('position_update', { vehicle_id: 'TRK-01', lat: 6.5 }));
    expect(onPosition).toHaveBeenCalledWith({ vehicle_id: 'TRK-01', lat: 6.5 });
  });

  it('calls onAlert when alert_raised event fires', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const onAlert = vi.fn();
    renderHook(() => useEventStream({ onAlert }));
    act(() => FakeEventSource.instances[0].fire('alert_raised', { alert_id: 'a1', severity: 'high' }));
    expect(onAlert).toHaveBeenCalledWith({ alert_id: 'a1', severity: 'high' });
  });

  it('does not attach listener for callbacks not provided', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const onAlert = vi.fn();
    renderHook(() => useEventStream({ onAlert }));
    const es = FakeEventSource.instances[0];
    // Only alert_raised and connected should have listeners; others should not
    expect(es._listeners['trip_started']).toBeUndefined();
    expect(es._listeners['trip_completed']).toBeUndefined();
    expect(es._listeners['position_update']).toBeUndefined();
    expect(es._listeners['alert_raised']).toHaveLength(1);
  });

  it('silently ignores malformed JSON in event data', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const onAlert = vi.fn();
    renderHook(() => useEventStream({ onAlert }));
    const es = FakeEventSource.instances[0];
    const handlers = es._listeners['alert_raised'];
    // Fire with invalid JSON directly
    act(() => handlers[0]({ data: 'not-json', type: 'alert_raised' }));
    expect(onAlert).not.toHaveBeenCalled();
  });

  // ── Back-off reset ──────────────────────────────────────────────────

  it('resets retry delay to base on connected event', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const { result } = renderHook(() => useEventStream({ onAlert: vi.fn() }));
    const es = FakeEventSource.instances[0];
    // Simulate a prior error that would have bumped retryMs, then reconnect
    act(() => es.triggerError());
    act(() => vi.advanceTimersByTime(2000)); // base delay
    const es2 = FakeEventSource.instances[1];
    // Signal successful connect
    act(() => es2.fire('connected', {}));
    // Now trigger another error — should wait 2000ms (reset), not 4000ms
    act(() => es2.triggerError());
    const beforeAdvance = FakeEventSource.instances.length;
    act(() => vi.advanceTimersByTime(1999));
    expect(FakeEventSource.instances.length).toBe(beforeAdvance); // not yet
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances.length).toBe(beforeAdvance + 1); // reconnected
  });

  // ── Reconnect / backoff ─────────────────────────────────────────────

  it('reconnects after base delay (2s) when EventSource errors', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    renderHook(() => useEventStream({ onAlert: vi.fn() }));
    expect(FakeEventSource.instances).toHaveLength(1);

    act(() => FakeEventSource.instances[0].triggerError());
    expect(FakeEventSource.instances).toHaveLength(1); // no immediate reconnect

    act(() => vi.advanceTimersByTime(2000));
    expect(FakeEventSource.instances).toHaveLength(2); // reconnected
  });

  it('closes old EventSource on error before reconnecting', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    renderHook(() => useEventStream({ onAlert: vi.fn() }));
    const es1 = FakeEventSource.instances[0];

    act(() => es1.triggerError());
    expect(es1.closed).toBe(true);
  });

  it('doubles retry delay on successive errors (exponential backoff)', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    renderHook(() => useEventStream({ onAlert: vi.fn() }));

    // Error 1 → retry after 2s
    act(() => FakeEventSource.instances[0].triggerError());
    act(() => vi.advanceTimersByTime(2000));
    expect(FakeEventSource.instances).toHaveLength(2);

    // Error 2 → retry after 4s
    act(() => FakeEventSource.instances[1].triggerError());
    act(() => vi.advanceTimersByTime(3999));
    expect(FakeEventSource.instances).toHaveLength(2); // not yet
    act(() => vi.advanceTimersByTime(1));
    expect(FakeEventSource.instances).toHaveLength(3);
  });

  // ── Cleanup on unmount ──────────────────────────────────────────────

  it('closes EventSource on unmount', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const { unmount } = renderHook(() => useEventStream({ onAlert: vi.fn() }));
    const es = FakeEventSource.instances[0];

    unmount();
    expect(es.closed).toBe(true);
  });

  it('does not reconnect after unmount even if error fires before cleanup', () => {
    localStorage.setItem(TOKEN_KEY, 'tok');
    const { unmount } = renderHook(() => useEventStream({ onAlert: vi.fn() }));
    const es = FakeEventSource.instances[0];

    act(() => es.triggerError()); // schedules reconnect
    unmount();                    // sets unmounted flag + cancels timer

    act(() => vi.advanceTimersByTime(10_000));
    expect(FakeEventSource.instances).toHaveLength(1); // no new connection
  });
});
