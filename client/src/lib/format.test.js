import { describe, it, expect } from 'vitest';
import { formatTonnes, formatUsd, formatGhs, formatPercent, formatKm, formatLongDate } from './format.js';

describe('formatTonnes', () => {
  it('returns em dash for null', () => expect(formatTonnes(null)).toBe('—'));
  it('returns em dash for undefined', () => expect(formatTonnes(undefined)).toBe('—'));
  it('rounds and appends t', () => expect(formatTonnes(1234)).toBe('1,234 t'));
  it('rounds fractional value', () => expect(formatTonnes(1234.7)).toBe('1,235 t'));
  it('formats zero', () => expect(formatTonnes(0)).toBe('0 t'));
  it('formats large number with comma separator', () => expect(formatTonnes(1_000_000)).toBe('1,000,000 t'));
});

describe('formatUsd', () => {
  it('returns em dash for null', () => expect(formatUsd(null)).toBe('—'));
  it('returns em dash for undefined', () => expect(formatUsd(undefined)).toBe('—'));
  it('formats integer with dollar prefix', () => expect(formatUsd(5000)).toBe('$5,000'));
  it('rounds to nearest integer', () => expect(formatUsd(5000.9)).toBe('$5,001'));
  it('millions option divides by 1M with one decimal', () => expect(formatUsd(2_500_000, { millions: true })).toBe('$2.5M'));
  it('millions option formats exactly', () => expect(formatUsd(1_000_000, { millions: true })).toBe('$1.0M'));
  it('formats zero', () => expect(formatUsd(0)).toBe('$0'));
});

describe('formatGhs', () => {
  it('returns em dash for null', () => expect(formatGhs(null)).toBe('—'));
  it('returns em dash for undefined', () => expect(formatGhs(undefined)).toBe('—'));
  it('formats with GHS prefix and 2 decimal places', () => expect(formatGhs(1234.5)).toBe('GHS 1,234.50'));
  it('formats whole number with .00', () => expect(formatGhs(500)).toBe('GHS 500.00'));
  it('formats zero', () => expect(formatGhs(0)).toBe('GHS 0.00'));
});

describe('formatPercent', () => {
  it('returns em dash for null', () => expect(formatPercent(null)).toBe('—'));
  it('returns em dash for undefined', () => expect(formatPercent(undefined)).toBe('—'));
  it('defaults to 1 decimal place', () => expect(formatPercent(12.345)).toBe('12.3%'));
  it('respects custom decimal count', () => expect(formatPercent(12.345, 2)).toBe('12.35%'));
  it('formats zero', () => expect(formatPercent(0)).toBe('0.0%'));
  it('formats 100', () => expect(formatPercent(100)).toBe('100.0%'));
});

describe('formatKm', () => {
  it('returns em dash for null', () => expect(formatKm(null)).toBe('—'));
  it('returns em dash for undefined', () => expect(formatKm(undefined)).toBe('—'));
  it('rounds and appends km', () => expect(formatKm(423.6)).toBe('424 km'));
  it('formats zero', () => expect(formatKm(0)).toBe('0 km'));
  it('formats large distance', () => expect(formatKm(2500)).toBe('2,500 km'));
});

describe('formatLongDate', () => {
  it('formats a known date in en-GB style', () => {
    const d = new Date('2026-05-20T00:00:00Z');
    const result = formatLongDate(d);
    expect(result).toMatch(/20 May 2026/);
  });
  it('formats first of month without leading zero issues', () => {
    const d = new Date('2026-01-01T00:00:00Z');
    const result = formatLongDate(d);
    expect(result).toMatch(/January 2026/);
  });
});
