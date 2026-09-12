import { render, screen } from '@testing-library/react';
import { App } from './App';

// jsdom has no Worker, so analysis never succeeds here. That is useful: these
// tests double as proof that the interface stays usable while the analyzer is
// unavailable, which is what a slow connection looks like for a second.

describe('App shell', () => {
  it('exposes landmark regions and headings', async () => {
    render(<App />);

    expect(await screen.findByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('contentinfo')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: /terravisual/i })).toBeInTheDocument();
  });

  it('names each pane so screen reader users can tell them apart', async () => {
    render(<App />);

    expect(await screen.findByRole('region', { name: /code/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /infrastructure/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /problems/i })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /details/i })).toBeInTheDocument();
  });

  // The privacy claim is the product's central promise (NFR-1). Losing it
  // should take a failing test, not a redesign nobody checked.
  it('states the privacy guarantee', async () => {
    render(<App />);

    expect(await screen.findByText(/never leaves your browser/i)).toBeInTheDocument();
  });

  it('qualifies the privacy guarantee where the guarantee is made', async () => {
    render(<App />);

    const disclosure = await screen.findByText(/what that covers, and what it cannot/i);

    expect(disclosure).toBeInTheDocument();
    // Closed by default: it informs whoever looks and interrupts nobody else.
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
  });

  it('names the two limits that are real', async () => {
    render(<App />);

    await screen.findByText(/what that covers, and what it cannot/i);
    expect(screen.getByText(/a share link contains your code/i)).toBeInTheDocument();
    expect(screen.getByText(/browser extensions are outside this/i)).toBeInTheDocument();
  });

  it('says what the diagram is waiting for when there is no model yet', async () => {
    render(<App />);

    expect(await screen.findByTestId('diagram-waiting')).toBeInTheDocument();
  });

  it('invites a selection in the details pane', async () => {
    render(<App />);

    expect(await screen.findByTestId('details-empty')).toBeInTheDocument();
  });

  // A blank editor asks somebody who came to learn Terraform to already know some.
  it('opens with an example workspace rather than an empty page', async () => {
    render(<App />);

    expect(await screen.findByTestId('editor')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: /terraform source/i })).toBeInTheDocument();
  });

  it('offers a way to bring an existing project in', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: /import project/i })).toBeInTheDocument();
  });

  it('offers a way to start over', async () => {
    render(<App />);

    expect(await screen.findByRole('button', { name: /^reset$/i })).toBeInTheDocument();
  });
});
