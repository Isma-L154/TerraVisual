import awsVpc from '../../../schemas/examples/aws-vpc.json';
import empty from '../../../schemas/examples/empty.json';
import truncated from '../../../schemas/examples/truncated.json';

import { displayValue, isSupportedModel, SCHEMA_VERSION } from './index';
import type { Attribute, InfraModel } from './index';

// The same examples are validated against the schema by a Go test, so a drift
// between the schema and either language breaks a build.
const examples: InfraModel[] = [awsVpc as InfraModel, empty as InfraModel, truncated as InfraModel];

describe('InfraModel contract', () => {
  it('accepts every shared example', () => {
    for (const example of examples) {
      expect(isSupportedModel(example)).toBe(true);
      expect(example.schemaVersion).toBe(SCHEMA_VERSION);
    }
  });

  it('rejects a model from a version it does not understand', () => {
    expect(isSupportedModel({ ...empty, schemaVersion: 99 })).toBe(false);
  });

  it('rejects values that are not models at all', () => {
    for (const value of [null, undefined, 42, 'a string', [], {}]) {
      expect(isSupportedModel(value)).toBe(false);
    }
  });
});

describe('attribute honesty', () => {
  it('distinguishes an empty string from an undeterminable value', () => {
    const emptyString: Attribute = { known: true, value: '' };
    const undeterminable: Attribute = { known: false, reason: 'depends on a data source' };

    expect(displayValue(emptyString)).toBe('');
    expect(displayValue(undeterminable)).toBeNull();
  });

  it('renders null as a value rather than as unknown', () => {
    expect(displayValue({ known: true, value: null })).toBe('null');
  });

  it('carries a reason on every unknown in the examples', () => {
    const unknowns = examples
      .flatMap((model) => model.nodes)
      .flatMap((node) => Object.values(node.attributes))
      .filter((attribute) => !attribute.known);

    expect(unknowns.length).toBeGreaterThan(0);
    for (const attribute of unknowns) expect(attribute.reason).toBeTruthy();
  });
});
