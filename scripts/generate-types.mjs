// Generates the TypeScript view of the schemas.
//
// The JSON Schema is the single source of truth. Go validates itself against
// it in a test; TypeScript is generated from it here. CI regenerates and fails
// on any diff, so the two languages cannot quietly drift apart — which is the
// whole reason the schema exists as a separate artifact rather than as types
// written twice.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFromFile } from 'json-schema-to-typescript';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const targets = [
  {
    schema: path.join(repoRoot, 'schemas', 'infra-model.schema.json'),
    output: path.join(repoRoot, 'web', 'src', 'model', 'generated', 'infra-model.ts'),
  },
  {
    schema: path.join(repoRoot, 'schemas', 'catalog-entry.schema.json'),
    output: path.join(repoRoot, 'web', 'src', 'model', 'generated', 'catalog.ts'),
  },
];

const banner = `/**
 * Generated from the JSON Schema. Do not edit by hand.
 *
 * Run \`npm run generate\` after changing a file under schemas/.
 * CI regenerates and fails on any difference.
 */`;

const check = process.argv.includes('--check');
let drifted = false;

for (const { schema, output } of targets) {
  const generated =
    banner +
    '\n' +
    (await compileFromFile(schema, {
      bannerComment: '',
      additionalProperties: false,
      style: { singleQuote: true, printWidth: 100 },
    }));

  const existing = fs.existsSync(output) ? fs.readFileSync(output, 'utf8') : null;
  const relative = path.relative(repoRoot, output);

  if (existing === generated) {
    console.log(`up to date  ${relative}`);
    continue;
  }

  if (check) {
    console.error(`OUT OF DATE ${relative}`);
    drifted = true;
    continue;
  }

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, generated, 'utf8');
  console.log(`written     ${relative}`);
}

if (drifted) {
  console.error(
    '\nGenerated types do not match the schemas. Run "npm run generate" and commit the result.\n',
  );
  process.exit(1);
}
