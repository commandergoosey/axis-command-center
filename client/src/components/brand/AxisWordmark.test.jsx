import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AxisWordmark from './AxisWordmark.jsx';

describe('AxisWordmark', () => {
  it('renders without throwing', () => {
    expect(() => render(<AxisWordmark />)).not.toThrow();
  });

  it('renders "AXIS" text', () => {
    render(<AxisWordmark />);
    expect(screen.getByText('AXIS')).toBeTruthy();
  });

  it('has aria-label="AXIS"', () => {
    render(<AxisWordmark />);
    expect(screen.getByLabelText('AXIS')).toBeTruthy();
  });

  it('renders a span element', () => {
    const { container } = render(<AxisWordmark />);
    expect(container.querySelector('span')).toBeTruthy();
  });

  it('default size is 14', () => {
    const { container } = render(<AxisWordmark />);
    const span = container.querySelector('span');
    expect(span.style.fontSize).toBe('14px');
  });

  it('size prop sets font size', () => {
    const { container } = render(<AxisWordmark size={20} />);
    const span = container.querySelector('span');
    expect(span.style.fontSize).toBe('20px');
  });

  it('default color is charcoal css variable', () => {
    const { container } = render(<AxisWordmark />);
    const span = container.querySelector('span');
    expect(span.style.color).toBe('var(--charcoal)');
  });

  it('color prop overrides default color', () => {
    const { container } = render(<AxisWordmark color="white" />);
    const span = container.querySelector('span');
    expect(span.style.color).toBe('white');
  });

  it('renders with role implied by aria-label', () => {
    render(<AxisWordmark />);
    // The span carries aria-label making it accessible
    const el = screen.getByLabelText('AXIS');
    expect(el.textContent).toBe('AXIS');
  });
});
