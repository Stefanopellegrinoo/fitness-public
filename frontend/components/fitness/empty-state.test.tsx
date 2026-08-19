// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Calendar } from 'lucide-react';
import { EmptyState } from './empty-state';

describe('EmptyState', () => {
  it('renders the title and description', () => {
    render(
      <EmptyState
        icon={Calendar}
        title="Todavía no registraste comidas"
        description="Cargá tu primera comida para ver tus macros del día"
      />
    );
    expect(screen.getByText('Todavía no registraste comidas')).toBeTruthy();
    expect(screen.getByText('Cargá tu primera comida para ver tus macros del día')).toBeTruthy();
  });

  it('renders no action when actionLabel is omitted', () => {
    render(<EmptyState icon={Calendar} title="Sin datos" />);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('renders a button action and calls onAction when clicked', () => {
    const onAction = vi.fn();
    render(
      <EmptyState
        icon={Calendar}
        title="Sin rutinas"
        actionLabel="Nueva rutina"
        onAction={onAction}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'Nueva rutina' }));
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it('renders a link action when actionHref is provided', () => {
    render(
      <EmptyState
        icon={Calendar}
        title="Sin comidas"
        actionLabel="Registrar comida"
        actionHref="/nutrition"
      />
    );
    const link = screen.getByRole('link', { name: 'Registrar comida' });
    expect(link.getAttribute('href')).toBe('/nutrition');
  });
});
