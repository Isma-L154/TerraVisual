/**
 * The interface's half of the catalog.
 *
 * The analyzer reads the same files for containment rules; this reads them for
 * presentation — display name, icon, documentation. One source, two consumers,
 * which is the whole point of ADR-0004.
 */

import awsCatalog from '../../../catalog/aws.json';
import type { Catalog, CatalogEntry } from '../model';

const catalogs: Catalog[] = [awsCatalog as Catalog];

const byType = new Map<string, CatalogEntry>();
for (const catalog of catalogs) {
  for (const entry of catalog.entries) byType.set(entry.type, entry);
}

export function lookup(resourceType: string): CatalogEntry | undefined {
  return byType.get(resourceType);
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

/** How many resource types the catalog knows. Used by tests. */
export function catalogSize(): number {
  return byType.size;
}
