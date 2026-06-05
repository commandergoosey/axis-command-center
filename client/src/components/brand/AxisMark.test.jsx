import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import AxisMark from './AxisMark.jsx';

describe('AxisMark', () => {
  it('renders an SVG element', () => {
    const { container } = render(<AxisMark />);
    expect(container.querySelector('svg')).toBeTruthy();
  });

  it('has role="img"', () => {
    render(<AxisMark />);
    expect(screen.getByRole('img')).toBeTruthy();
  });

  it('contains a <title> element', () => {
    const { container } = render(<AxisMark />);
    expect(container.querySelector('title')).toBeTruthy();
  });

  it('default title is "AXIS"', () => {
    const { container } = render(<AxisMark />);
    expect(container.querySelector('title').textContent).toBe('AXIS');
  });

  it('size prop sets width on the SVG', () => {
    const { container } = render(<AxisMark size={48} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('48');
  });

  it('size prop sets height on the SVG', () => {
    const { container } = render(<AxisMark size={48} />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('height')).toBe('48');
  });

  it('default size is 24', () => {
    const { container } = render(<AxisMark />);
    const svg = container.querySelector('svg');
    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
  });

  it('custom title sets aria-label', () => {
    render(<AxisMark title="AXIS brand mark" />);
    expect(screen.getByLabelText('AXIS brand mark')).toBeTruthy();
  });

  it('custom title also sets the <title> element', () => {
    const { container } = render(<AxisMark title="Custom" />);
    expect(container.querySelector('title').textContent).toBe('Custom');
  });

  it('renders without throwing', () => {
    expect(() => render(<AxisMark />)).not.toThrow();
  });
});
