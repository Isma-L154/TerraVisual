import { render, screen } from '@testing-library/react';
import { App } from './App';

// The session loads asynchronously now — a shared link is decoded, then
// storage is consulted, then the example is used. So these tests wait, which
// is what a real visitor does too.
//
// jsdom has no Worker, so analysis always fails here. That is useful rather
// than awkward: these tests double as proof that the interface stays usable
// when the analyzer is unavailable, which is what somebody on a slow
// connection sees for the first second.

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

  // The privacy claim is the product's central promise (NFR-1). Removing it
  // from the interface should be a deliberate act with a failing test behind
  // it, not an accident during a redesign.
  it('states the privacy guarantee', async () => {
    render(<App />);

    expect(await screen.findByText(/never leaves your browser/i)).toBeInTheDocument();
  });

  // The claim above is true; the qualification keeps it from being read as a
  // stronger guarantee than any website can make. Somebody about to paste real
  // infrastructure should be able to find both in one place.
  it('qualifies the privacy guarantee where the guarantee is made', async () => {
    render(<App />);

    const disclosure = await screen.findByText(/what that covers, and what it cannot/i);
    expect(disclosure).toBeInTheDocument();

    // Closed by default: it informs somebody who looks, and interrupts nobody
    // who does not.
    expect(disclosure.closest('details')).not.toHaveAttribute('open');
  });

  it('names the two limits that are real', async () => {
    render(<App />);

    await screen.findByText(/what that covers, and what it cannot/i);
    expect(screen.getByText(/a share link contains your code/i)).toBeInTheDocument();
    expect(screen.getByText(/browser extensions are outside this/i)).toBeInTheDocument();
  });

  // Without a Worker there is never a model, so the diagram says what it is
  // waiting for rather than showing an empty frame that reads as a bug.
  it('says what the diagram is waiting for when there is no model yet', async () => {
    render(<App />);

    expect(await screen.findByTestId('diagram-waiting')).toBeInTheDocument();
  });

  it('invites a selection in the details pane', async () => {
    render(<App />);

    expect(await screen.findByTestId('details-empty')).toBeInTheDocument();
  });

  // A blank editor is a bad first screen for a teaching tool: it asks somebody
  // who came here to learn Terraform to already know some.
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
