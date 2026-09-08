import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { Diagnostic } from '../model';
import { DiagnosticsList } from './DiagnosticsList';

const problem: Diagnostic = {
  severity: 'error',
  code: 'syntax-error',
  message: 'Unterminated template string',
  source: { file: 'main.tf', startLine: 8, startCol: 3, endLine: 8, endCol: 20 },
};

const note: Diagnostic = {
  severity: 'info',
  code: 'data-source-not-resolved',
  message: 'data.aws_ami.ubuntu is read from the cloud provider',
  source: { file: 'main.tf', startLine: 2, startCol: 1, endLine: 4, endCol: 2 },
};

describe('diagnostics list', () => {
  it('says plainly when there is nothing wrong', () => {
    render(<DiagnosticsList diagnostics={[]} />);

    expect(screen.getByText(/no problems found/i)).toBeInTheDocument();
  });

  it('lists each diagnostic with its location', () => {
    render(<DiagnosticsList diagnostics={[problem, note]} />);

    expect(screen.getByText(problem.message)).toBeInTheDocument();
    expect(screen.getByText(note.message)).toBeInTheDocument();
    expect(screen.getByText(/main\.tf, line 8/)).toBeInTheDocument();
  });

  // Severity carried by a word, not only by a colour. Colour alone is
  // invisible to a colourblind user and to anyone listening rather than
  // looking.
  it('names each severity in text', () => {
    render(<DiagnosticsList diagnostics={[problem, note]} />);

    expect(screen.getByText('Error')).toBeInTheDocument();
    expect(screen.getByText('Note')).toBeInTheDocument();
  });

  // The count is announced so a screen reader user learns that something broke
  // without having to go looking for it.
  it('announces a summary in a live region', () => {
    render(<DiagnosticsList diagnostics={[problem, note]} />);

    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('1 error');
    expect(status).toHaveTextContent('1 note');
  });

  it('pluralises correctly', () => {
    render(<DiagnosticsList diagnostics={[problem, { ...problem, message: 'another' }]} />);

    expect(screen.getByRole('status')).toHaveTextContent('2 errors');
  });

  it('lets each diagnostic be activated from the keyboard', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<DiagnosticsList diagnostics={[problem]} onSelect={onSelect} />);

    await user.tab();
    await user.keyboard('{Enter}');

    expect(onSelect).toHaveBeenCalledWith(problem);
  });

  // Diagnostic messages contain user-derived text: resource names, file paths,
  // values. React escapes by default and this makes sure nothing later routes
  // around it.
  it('renders a message containing markup as text', () => {
    render(
      <DiagnosticsList diagnostics={[{ ...problem, message: '<img src=x onerror="alert(1)">' }]} />,
    );

    expect(screen.getByText('<img src=x onerror="alert(1)">')).toBeInTheDocument();
    expect(document.querySelector('img')).toBeNull();
  });
});
