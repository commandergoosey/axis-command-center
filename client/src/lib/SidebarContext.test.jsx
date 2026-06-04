import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import React from 'react';
import { SidebarProvider, useSidebar, SIDEBAR_COLLAPSED_W, SIDEBAR_EXPANDED_W } from './SidebarContext.jsx';

function makeLocalStorageStub() {
  let store = {};
  return {
    getItem:    (k)    => store[k] ?? null,
    setItem:    (k, v) => { store[k] = String(v); },
    removeItem: (k)    => { delete store[k]; },
    clear:      ()     => { store = {}; },
  };
}

const STORAGE_KEY = 'axis.sidebar.expanded';
const wrapper = ({ children }) => <SidebarProvider>{children}</SidebarProvider>;

describe('SidebarContext', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', makeLocalStorageStub()); });
  afterEach(()  => { vi.unstubAllGlobals(); });

  it('defaults to collapsed when no localStorage entry', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.expanded).toBe(false);
  });

  it('restores expanded=true from localStorage on mount', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.expanded).toBe(true);
  });

  it('restores collapsed when localStorage value is not "true"', () => {
    localStorage.setItem(STORAGE_KEY, 'false');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    expect(result.current.expanded).toBe(false);
  });

  it('toggle() flips collapsed → expanded', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(true);
  });

  it('toggle() flips expanded → collapsed', () => {
    localStorage.setItem(STORAGE_KEY, 'true');
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => result.current.toggle());
    expect(result.current.expanded).toBe(false);
  });

  it('toggle() persists new value to localStorage', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => result.current.toggle());
    expect(localStorage.getItem(STORAGE_KEY)).toBe('true');
    act(() => result.current.toggle());
    expect(localStorage.getItem(STORAGE_KEY)).toBe('false');
  });

  it('sets --sidebar-w CSS variable to collapsed width on mount', () => {
    renderHook(() => useSidebar(), { wrapper });
    expect(document.documentElement.style.getPropertyValue('--sidebar-w'))
      .toBe(`${SIDEBAR_COLLAPSED_W}px`);
  });

  it('sets --sidebar-w to expanded width after toggle', () => {
    const { result } = renderHook(() => useSidebar(), { wrapper });
    act(() => result.current.toggle());
    expect(document.documentElement.style.getPropertyValue('--sidebar-w'))
      .toBe(`${SIDEBAR_EXPANDED_W}px`);
  });

  it('exported width constants match design spec (56 / 180)', () => {
    expect(SIDEBAR_COLLAPSED_W).toBe(56);
    expect(SIDEBAR_EXPANDED_W).toBe(180);
  });
});
