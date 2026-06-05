import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import Button from './Button.jsx';

describe('Button', () => {
  it('renders a button element', () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole('button')).toBeTruthy();
  });

  it('renders children text', () => {
    render(<Button>Save</Button>);
    expect(screen.getByText('Save')).toBeTruthy();
  });

  it('onClick fires when clicked', () => {
    const handleClick = vi.fn();
    render(<Button onClick={handleClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).toHaveBeenCalledTimes(1);
  });

  it('disabled button does not fire onClick', () => {
    const handleClick = vi.fn();
    render(<Button disabled onClick={handleClick}>Go</Button>);
    fireEvent.click(screen.getByRole('button'));
    expect(handleClick).not.toHaveBeenCalled();
  });

  it('type defaults to button', () => {
    render(<Button>Submit</Button>);
    expect(screen.getByRole('button').type).toBe('button');
  });

  it('type prop is forwarded', () => {
    render(<Button type="submit">Submit</Button>);
    expect(screen.getByRole('button').type).toBe('submit');
  });

  it('disabled prop makes button disabled', () => {
    render(<Button disabled>Disabled</Button>);
    expect(screen.getByRole('button').disabled).toBe(true);
  });

  it('unknown variant falls back to secondary styles', () => {
    const { container } = render(<Button variant="nope">X</Button>);
    const btn = container.querySelector('button');
    expect(btn.style.background).toBe('var(--surface-raised)');
  });

  it('primary variant applies charcoal background', () => {
    const { container } = render(<Button variant="primary">Primary</Button>);
    const btn = container.querySelector('button');
    expect(btn.style.background).toBe('var(--charcoal)');
    expect(btn.style.color).toBe('var(--text-inverse)');
  });

  it('ghost variant applies transparent background', () => {
    const { container } = render(<Button variant="ghost">Ghost</Button>);
    const btn = container.querySelector('button');
    expect(btn.style.background).toBe('transparent');
  });

  it('secondary variant applies raised surface background', () => {
    const { container } = render(<Button variant="secondary">Secondary</Button>);
    const btn = container.querySelector('button');
    expect(btn.style.background).toBe('var(--surface-raised)');
  });
});
