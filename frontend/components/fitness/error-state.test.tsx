// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorState } from './error-state';

describe('ErrorState', () => {
  it('renders the default title when none is provided', () => {
    render(<ErrorState description="No pudimos cargar tus métricas." />);
    expect(screen.getByText('Algo salió mal')).toBeTruthy();
    expect(screen.getByText('No pudimos cargar tus métricas.')).toBeTruthy();
  });

  it('renders a custom title when provided', () => {
    render(<ErrorState title="No pudimos cargar tu progreso" description="Revisá tu conexión e intentá de nuevo." />);
    expect(screen.getByText('No pudimos cargar tu progreso')).toBeTruthy();
  });

  it('does not render a retry button when onRetry is omitted', () => {
    render(<ErrorState description="Algo falló." />);
    expect(screen.queryByRole('button', { name: 'Reintentar' })).toBeNull();
  });

  it('renders a retry button and calls onRetry when clicked', () => {
    const onRetry = vi.fn();
    render(<ErrorState description="Algo falló." onRetry={onRetry} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });
});
