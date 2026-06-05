import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import StatusBadge from './StatusBadge.jsx';

describe('StatusBadge', () => {
  it('renders children text', () => {
    render(<StatusBadge>Active</StatusBadge>);
    expect(screen.getByText('Active')).toBeTruthy();
  });

  it('renders a span element', () => {
    const { container } = render(<StatusBadge>Test</StatusBadge>);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('unknown tone falls back to neutral styles', () => {
    const { container } = render(<StatusBadge tone="unknown">X</StatusBadge>);
    const span = container.querySelector('span');
    expect(span.style.background).toBe('var(--ash)');
    expect(span.style.color).toBe('var(--iron)');
  });

  it('default tone is neutral', () => {
    const { container } = render(<StatusBadge>X</StatusBadge>);
    const span = container.querySelector('span');
    expect(span.style.background).toBe('var(--ash)');
    expect(span.style.color).toBe('var(--iron)');
  });

  it('pending tone applies rust background', () => {
    const { container } = render(<StatusBadge tone="pending">Pending</StatusBadge>);
    const span = container.querySelector('span');
    expect(span.style.background).toBe('rgba(162, 62, 35, 0.08)');
    expect(span.style.color).toBe('var(--bauxite-rust)');
  });

  it('connected tone applies green styles', () => {
    const { container } = render(<StatusBadge tone="connected">Connected</StatusBadge>);
    const span = container.querySelector('span');
    expect(span.style.background).toBe('rgba(46, 107, 63, 0.1)');
    expect(span.style.color).toBe('var(--signal-green)');
  });

  it('degraded tone applies amber styles', () => {
    const { container } = render(<StatusBadge tone="degraded">Degraded</StatusBadge>);
    const span = container.querySelector('span');
    expect(span.style.background).toBe('rgba(184, 134, 11, 0.12)');
    expect(span.style.color).toBe('var(--signal-amber)');
  });

  it('active tone applies ash/iron styles', () => {
    const { container } = render(<StatusBadge tone="active">Active</StatusBadge>);
    const span = container.querySelector('span');
    expect(span.style.background).toBe('var(--ash)');
    expect(span.style.color).toBe('var(--iron)');
  });

  it('manual tone applies ash/iron styles', () => {
    const { container } = render(<StatusBadge tone="manual">Manual</StatusBadge>);
    const span = container.querySelector('span');
    expect(span.style.background).toBe('var(--ash)');
    expect(span.style.color).toBe('var(--iron)');
  });

  it('active and manual tones differ from connected tone', () => {
    const { container: c1 } = render(<StatusBadge tone="active">A</StatusBadge>);
    const { container: c2 } = render(<StatusBadge tone="connected">B</StatusBadge>);
    expect(c1.querySelector('span').style.color).not.toBe(c2.querySelector('span').style.color);
  });
});
