import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import PillToggle from './PillToggle.jsx';

const OPTIONS = [
  { value: 'schematic', label: 'Schematic' },
  { value: 'map', label: 'Map' },
];

describe('PillToggle', () => {
  it('renders all option labels', () => {
    render(<PillToggle value="schematic" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByText('Schematic')).toBeTruthy();
    expect(screen.getByText('Map')).toBeTruthy();
  });

  it('has role="tablist" on the container', () => {
    render(<PillToggle value="schematic" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('tablist')).toBeTruthy();
  });

  it('active option has aria-selected=true', () => {
    render(<PillToggle value="schematic" onChange={() => {}} options={OPTIONS} />);
    const activeTab = screen.getByRole('tab', { name: 'Schematic' });
    expect(activeTab.getAttribute('aria-selected')).toBe('true');
  });

  it('inactive option has aria-selected=false', () => {
    render(<PillToggle value="schematic" onChange={() => {}} options={OPTIONS} />);
    const inactiveTab = screen.getByRole('tab', { name: 'Map' });
    expect(inactiveTab.getAttribute('aria-selected')).toBe('false');
  });

  it('clicking inactive option calls onChange with its value', () => {
    const handleChange = vi.fn();
    render(<PillToggle value="schematic" onChange={handleChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Map' }));
    expect(handleChange).toHaveBeenCalledWith('map');
  });

  it('clicking active option still calls onChange', () => {
    const handleChange = vi.fn();
    render(<PillToggle value="schematic" onChange={handleChange} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Schematic' }));
    expect(handleChange).toHaveBeenCalledWith('schematic');
  });

  it('correct option is active based on value prop', () => {
    render(<PillToggle value="map" onChange={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('tab', { name: 'Map' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Schematic' }).getAttribute('aria-selected')).toBe('false');
  });

  it('renders with three or more options', () => {
    const threeOptions = [
      { value: 'a', label: 'Alpha' },
      { value: 'b', label: 'Beta' },
      { value: 'c', label: 'Gamma' },
    ];
    render(<PillToggle value="b" onChange={() => {}} options={threeOptions} />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(3);
    expect(tabs[1].getAttribute('aria-selected')).toBe('true');
  });
});
