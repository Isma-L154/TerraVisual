/**
 * Generated from the JSON Schema. Do not edit by hand.
 *
 * Run `npm run generate` after changing a file under schemas/.
 * CI regenerates and fails on any difference.
 */
export type Identifier = string;

/**
 * The contract between analysis and presentation. The analyzer is its only producer; the layout, the diagram and the accessible tree are pure consumers. This schema is also the validation boundary for shared links, which carry untrusted data, so it is deliberately strict: no additional properties, explicit types, and bounded sizes throughout.
 */
export interface InfraModel {
  /**
   * Consumers refuse a model they do not understand rather than misreading it.
   */
  schemaVersion: 1;
  /**
   * @maxItems 20000
   */
  nodes: Node[];
  /**
   * @maxItems 50000
   */
  edges: Edge[];
  /**
   * @maxItems 5000
   */
  diagnostics: Diagnostic[];
  stats: Stats;
}
export interface Node {
  id: Identifier;
  /**
   * The Terraform address, including any count or for_each key.
   */
  address: string;
  /**
   * Terraform resource type, or a synthetic type for containers the catalog introduces.
   */
  type: string;
  provider: string;
  /**
   * Drives grouping and iconography. Open-ended on purpose: providers keep inventing categories.
   */
  category: string;
  /**
   * What the user sees. Derived from user input, so consumers must render it as text.
   */
  label: string;
  isContainer: boolean;
  /**
   * Decided by the catalog, not by HCL: Terraform has no concept of containment. Absent when the node sits at the top level or could not be placed.
   */
  parentId?: string;
  /**
   * True when containment could not be determined, so the interface can group the node honestly instead of guessing a parent.
   */
  unplaced: boolean;
  /**
   * False for resource types the catalog does not know. These are still drawn, marked as uncatalogued: a real project must never look empty, nor look complete when it is not.
   */
  catalogued: boolean;
  attributes: {
    [k: string]: Attribute;
  };
  expansion?: Expansion;
  source: Range;
  /**
   * The module this node was declared in, absent at the root. Recorded so the interface can say where a resource came from, and so containment can keep a module's contents together.
   */
  modulePath?: string;
}
/**
 * Unknown is a first-class value. There is no ambiguous null or empty string standing in for 'not determinable', so the interface can always tell 'empty' from 'unknown'.
 */
export interface Attribute {
  known: boolean;
  /**
   * Present only when known. Any JSON value, because Terraform attributes are.
   */
  value?: string | number | boolean | {} | unknown[] | null;
  /**
   * Why the value could not be determined. Written for a learner: 'depends on a data source, which needs cloud credentials' teaches something; 'unknown' does not.
   */
  reason?: string;
}
/**
 * Present when the node is one instance of a count or for_each block.
 */
export interface Expansion {
  kind: 'count' | 'for_each';
  index?: number;
  key?: string;
  /**
   * Absent when the instance count could not be determined.
   */
  total?: number;
  /**
   * True when expansion hit a hard limit, so the interface can say the picture is partial.
   */
  truncated?: boolean;
}
/**
 * Present on nodes, edges and diagnostics alike. This is what makes bidirectional code and diagram navigation possible.
 */
export interface Range {
  file: string;
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}
export interface Edge {
  id: Identifier;
  from: Identifier;
  to: Identifier;
  /**
   * Curated relationship type. Which relationships earn an edge is an editorial decision recorded in the catalog, not every reference in the code.
   */
  kind: string;
  label?: string;
  source: Range;
  /**
   * Whether this relationship should appear in the diagram. The model carries every reference; the catalog decides which few teach something. A relationship recorded but not drawn is still available to search, explain and announce.
   */
  drawn: boolean;
}
export interface Diagnostic {
  severity: 'error' | 'warning' | 'info';
  /**
   * Stable identifier so messages can be tested and translated without matching on prose.
   */
  code?: string;
  message: string;
  source: Range;
}
export interface Stats {
  files: number;
  resources: number;
  durationMs: number;
  /**
   * A hard limit was reached. The interface must say so rather than presenting a partial picture as a complete one.
   */
  truncated: boolean;
}
