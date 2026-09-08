import { render, screen } from '@testing-library/react';

import awsVpc from '../../../schemas/examples/aws-vpc.json';
import type { InfraModel, InfraNode } from '../model';
import { NodeDetails } from './NodeDetails';

const example = awsVpc as InfraModel;
const instance = example.nodes.find((node) => node.id === 'aws_instance.web[0]')!;
const exotic = example.nodes.find((node) => node.id === 'some_exotic_thing.x')!;

describe('node details', () => {
  it('invites a selection when there is none', () => {
    render(<NodeDetails node={null} />);

    expect(screen.getByTestId('details-empty')).toBeInTheDocument();
  });

  it('shows what the resource is and where it came from', () => {
    render(<NodeDetails node={instance} />);

    expect(screen.getByText('aws_instance.web[0]')).toBeInTheDocument();
    expect(screen.getByText('EC2 Instance')).toBeInTheDocument();
    expect(screen.getByText('main.tf:12')).toBeInTheDocument();
  });

  it('shows determinable values', () => {
    render(<NodeDetails node={instance} />);

    expect(screen.getByText('t3.micro')).toBeInTheDocument();
  });

  // This is where NFR-9 becomes visible. The reason is the part that teaches:
  // "unknown" alone is a dead end.
  it('shows an undeterminable value as unknown, with the reason', () => {
    render(<NodeDetails node={instance} />);

    expect(screen.getByText('Unknown')).toBeInTheDocument();
    expect(screen.getByText(/needs cloud credentials/)).toBeInTheDocument();
  });

  it('says when a type is not catalogued', () => {
    render(<NodeDetails node={exotic} />);

    expect(screen.getByText(/not in the catalog yet/i)).toBeInTheDocument();
  });

  it('says when a resource declares nothing', () => {
    render(<NodeDetails node={exotic} />);

    expect(screen.getByText(/declares no attributes/i)).toBeInTheDocument();
  });

  it('links to the provider documentation when the catalog has it', () => {
    render(<NodeDetails node={instance} />);

    const link = screen.getByRole('link', { name: /terraform documentation/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('registry.terraform.io'));
    // Opening in a new tab without noopener hands the new page a reference
    // back to this one.
    expect(link).toHaveAttribute('rel', expect.stringContaining('noopener'));
  });

  it('exposes attributes as a table with row headers', () => {
    render(<NodeDetails node={instance} />);

    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: 'instance_type' })).toBeInTheDocument();
  });

  // Resource names and values are user-derived and reach the DOM here.
  it('renders a value containing markup as text', () => {
    const hostile: InfraNode = {
      ...instance,
      label: '<img src=x onerror="alert(1)">',
      attributes: {
        name: { known: true, value: '<script>alert(1)</script>' },
      },
    };
    render(<NodeDetails node={hostile} />);

    expect(screen.getByText('<script>alert(1)</script>')).toBeInTheDocument();
    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img')).toBeNull();
  });
});
