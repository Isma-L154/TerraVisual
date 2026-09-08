import { render, screen } from '@testing-library/react';
import { App } from './App';

// jsdom has no Worker, so analysis always fails here. That is useful rather
// than awkward: these tests double as proof that the interface stays usable
// when the analyzer is unavailable, which is exactly what a user on a slow
// connection sees for the first second.

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
    expect(screen.getByRole('region', { name: /problems/i })).toBeInTheDocument();
  });

  // The privacy claim is the product's central promise (NFR-1). Removing it
  // from the interface should be a deliberate act with a failing test behind
  // it, not an accident during a redesign.
  it('states the privacy guarantee', () => {
    render(<App />);

    expect(screen.getByText(/never leaves your browser/i)).toBeInTheDocument();
  });

  it('says plainly that the diagram is not built yet', () => {
    render(<App />);

    expect(screen.getByText(/diagram is not built yet/i)).toBeInTheDocument();
  });

  // A blank editor is a bad first screen for a teaching tool: it asks somebody
  // who came here to learn Terraform to already know some.
  it('opens with an example workspace rather than an empty page', () => {
    render(<App />);

    expect(screen.getByTestId('editor')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /terraform source/i })).toBeInTheDocument();
  });
});
