import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import ModelledTag from './ModelledTag.jsx';

describe('ModelledTag', () => {
  it('renders "MODELLED" text', () => {
    render(<ModelledTag />);
    expect(screen.getByText('MODELLED')).toBeTruthy();
  });

  it('has aria-label="modelled figure"', () => {
    render(<ModelledTag />);
    expect(screen.getByLabelText('modelled figure')).toBeTruthy();
  });

  it('renders without throwing for light tone (default)', () => {
    expect(() => render(<ModelledTag tone="light" />)).not.toThrow();
  });

  it('renders without throwing for dark tone', () => {
    expect(() => render(<ModelledTag tone="dark" />)).not.toThrow();
  });

  it('light tone applies tertiary text color', () => {
    const { container } = render(<ModelledTag tone="light" />);
    const span = container.querySelector('span');
    expect(span.style.color).toBe('var(--text-tertiary)');
  });

  it('dark tone applies light rgba color', () => {
    const { container } = render(<ModelledTag tone="dark" />);
    const span = container.querySelector('span');
    expect(span.style.color).toBe('rgba(245, 241, 236, 0.7)');
  });

  it('dark tone applies light rgba border', () => {
    const { container } = render(<ModelledTag tone="dark" />);
    const span = container.querySelector('span');
    expect(span.style.border).toContain('rgba(245, 241, 236, 0.18)');
  });

  it('light tone applies hairline border', () => {
    const { container } = render(<ModelledTag tone="light" />);
    const span = container.querySelector('span');
    expect(span.style.border).toContain('var(--border-hairline)');
  });

  it('default tone is light', () => {
    const { container } = render(<ModelledTag />);
    const span = container.querySelector('span');
    expect(span.style.color).toBe('var(--text-tertiary)');
  });
});
