import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import EmptyState from './EmptyState.jsx';

describe('EmptyState', () => {
  it('renders the label', () => {
    render(<EmptyState label="No data available" />);
    expect(screen.getByText('No data available')).toBeTruthy();
  });

  it('always renders "Pending build" text', () => {
    render(<EmptyState label="Something" />);
    expect(screen.getByText('Pending build')).toBeTruthy();
  });

  it('renders note when provided', () => {
    render(<EmptyState label="Empty" note="Data will appear once ingested." />);
    expect(screen.getByText('Data will appear once ingested.')).toBeTruthy();
  });

  it('does not render note element when note is not provided', () => {
    const { container } = render(<EmptyState label="Empty" />);
    expect(container.querySelector('p')).toBeNull();
  });

  it('"Pending build" is present regardless of note', () => {
    const { rerender } = render(<EmptyState label="X" />);
    expect(screen.getByText('Pending build')).toBeTruthy();
    rerender(<EmptyState label="X" note="Some note" />);
    expect(screen.getByText('Pending build')).toBeTruthy();
  });

  it('renders both label and note together', () => {
    render(<EmptyState label="Corridor overview" note="Coming soon." />);
    expect(screen.getByText('Corridor overview')).toBeTruthy();
    expect(screen.getByText('Coming soon.')).toBeTruthy();
  });

  it('note is rendered in a paragraph element', () => {
    const { container } = render(<EmptyState label="X" note="A note" />);
    expect(container.querySelector('p')).toBeTruthy();
    expect(container.querySelector('p').textContent).toBe('A note');
  });
});
