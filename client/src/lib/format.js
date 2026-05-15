/*
 * Formatters — resolve to DESIGN_SYSTEM §2 number/unit conventions.
 * Tonnes (not tons). Kilometres. Long-form dates. USD with no space. GHS with space.
 */

export function formatTonnes(n) {
  if (n == null) return '—';
  return `${new Intl.NumberFormat('en-GB').format(Math.round(n))} t`;
}

export function formatUsd(n, { millions = false } = {}) {
  if (n == null) return '—';
  if (millions) return `$${(n / 1_000_000).toFixed(1)}M`;
  return `$${new Intl.NumberFormat('en-GB').format(Math.round(n))}`;
}

export function formatGhs(n) {
  if (n == null) return '—';
  return `GHS ${new Intl.NumberFormat('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n)}`;
}

export function formatPercent(n, decimals = 1) {
  if (n == null) return '—';
  return `${n.toFixed(decimals)}%`;
}

export function formatKm(n) {
  if (n == null) return '—';
  return `${new Intl.NumberFormat('en-GB').format(Math.round(n))} km`;
}

export function formatLongDate(d = new Date()) {
  return d.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}
