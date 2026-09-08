import { render, screen } from '@testing-library/react';
import { App } from './App';

describe('App shell', () => {
  it('exposes landmark regions and headings', () => {
    render(<App />);

    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /terravisual/i })).toBeInTheDocument();
  });

  it('names each pane so screen reader users can tell them apart', () => {
    render(<App />);

    expect(screen.getByRole('region', { name: /code/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /infrastructure/i })).toBeInTheDocument();
  });

  // The privacy claim is the product's central promise (NFR-1). If it is ever
  // removed from the interface, that should be a deliberate act with a failing
  // test behind it, not an accident during a redesign.
  it('states the privacy guarantee', () => {
    render(<App />);

    expect(screen.getByText(/never leaves your browser/i)).toBeInTheDocument();
  });

  it('says plainly which parts are not built yet', () => {
    render(<App />);

    expect(screen.getAllByText(/not built yet/i)).toHaveLength(2);
  });
});
