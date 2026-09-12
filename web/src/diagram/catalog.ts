/**
 * The interface's half of the catalog.
 *
 * The analyzer reads the same files for containment rules; this reads them for
 * presentation — display name, icon, documentation. One source, two consumers,
 * which is the whole point of ADR-0004.
 */

import type { Catalog, CatalogEntry } from '../model';

/**
 * Every catalog file, discovered rather than listed.
 *
 * ADR-0004 says adding a provider means adding data and never touching code.
 * A hand-written import list would have quietly made that false: a new
 * provider would need a line here, and the one that was forgotten would be
 * invisible in the interface while working perfectly in the analyzer.
 */
const modules = import.meta.glob<{ default: Catalog }>('../../../catalog/*.json', {
  eager: true,
});

const catalogs: Catalog[] = Object.keys(modules)
  .sort()
  .map((path) => modules[path]!.default);

const byType = new Map<string, CatalogEntry>();
for (const catalog of catalogs) {
  for (const entry of catalog.entries) byType.set(entry.type, entry);
}

/**
 * What to call a resource type on screen.
 *
 * The raw Terraform type is a poor label for somebody learning: `aws_db_instance`
 * is not how anyone says "RDS instance". Uncatalogued types fall back to the
 * raw type, which is honest — we genuinely do not know a better name.
 */
export function displayType(resourceType: string): string {
  return byType.get(resourceType)?.displayName ?? resourceType;
}

/** Documentation for a type, when the catalog has it. */
export function documentationUrl(resourceType: string): string | undefined {
  return byType.get(resourceType)?.documentationUrl;
}
