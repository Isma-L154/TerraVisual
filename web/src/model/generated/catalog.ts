/**
 * Generated from the JSON Schema. Do not edit by hand.
 *
 * Run `npm run generate` after changing a file under schemas/.
 * CI regenerates and fails on any difference.
 */
/**
 * Per-provider domain knowledge. This is not an icon table: it is where we decide, resource type by resource type, which reference means 'lives inside'. Terraform has no concept of containment, so the nesting the product draws is a decision recorded here. One file, two consumers -- the Go analyzer applies the rules, the interface reads the presentation.
 */
export interface Catalog {
  schemaVersion: 1;
  entries: Entry[];
}
export interface Entry {
  /**
   * The Terraform resource type this entry describes.
   */
  type: string;
  provider: 'aws' | 'azure' | 'gcp';
  /**
   * Comparable across providers on purpose, so a learner can see that a VPC and a VNet play the same role.
   */
  category:
    | 'network'
    | 'compute'
    | 'storage'
    | 'database'
    | 'loadbalancer'
    | 'serverless'
    | 'identity'
    | 'container'
    | 'observability'
    | 'security'
    | 'other';
  displayName: string;
  /**
   * Path within the icon set, without extension.
   */
  icon: string;
  /**
   * Whether other resources are drawn inside this one.
   */
  isContainer?: boolean;
  /**
   * Which attribute makes this resource a child of another, in priority order. For an aws_instance, subnet_id beats vpc_id: the more specific placement wins.
   *
   * @maxItems 8
   */
  parentRules?:
    | []
    | [ParentRule]
    | [ParentRule, ParentRule]
    | [ParentRule, ParentRule, ParentRule]
    | [ParentRule, ParentRule, ParentRule, ParentRule]
    | [ParentRule, ParentRule, ParentRule, ParentRule, ParentRule]
    | [ParentRule, ParentRule, ParentRule, ParentRule, ParentRule, ParentRule]
    | [ParentRule, ParentRule, ParentRule, ParentRule, ParentRule, ParentRule, ParentRule]
    | [
        ParentRule,
        ParentRule,
        ParentRule,
        ParentRule,
        ParentRule,
        ParentRule,
        ParentRule,
        ParentRule
      ];
  /**
   * Which references earn a drawn connection. Deliberately few: drawing every dependency produces the unreadable tangle this product exists to avoid.
   *
   * @maxItems 16
   */
  edgeRules?:
    | []
    | [EdgeRule]
    | [EdgeRule, EdgeRule]
    | [EdgeRule, EdgeRule, EdgeRule]
    | [EdgeRule, EdgeRule, EdgeRule, EdgeRule]
    | [EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule]
    | [EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule]
    | [EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule]
    | [EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule]
    | [EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule, EdgeRule]
    | [
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule
      ]
    | [
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule
      ]
    | [
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule
      ]
    | [
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule
      ]
    | [
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule
      ]
    | [
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule
      ]
    | [
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule,
        EdgeRule
      ];
  /**
   * How the node is labelled. Supports {{name}} and attribute references.
   */
  labelTemplate?: string;
  documentationUrl?: string;
}
export interface ParentRule {
  /**
   * The attribute whose reference this rule reads. A dotted path reaches inside a nested block, which is where some providers put their containment: an Azure network interface's subnet lives in ip_configuration.subnet_id, not at the top level.
   */
  attribute: string;
  /**
   * Lower wins. Ties are a catalog bug and the tests reject them.
   */
  priority: number;
}
export interface EdgeRule {
  /**
   * The attribute whose reference this rule reads. A dotted path reaches inside a nested block, which is where some providers put their containment: an Azure network interface's subnet lives in ip_configuration.subnet_id, not at the top level.
   */
  attribute: string;
  /**
   * traffic: something sends requests to something else. data: something reads or writes something else. control: something governs something else.
   */
  kind: 'traffic' | 'data' | 'control' | 'security';
  /**
   * False records the relationship in the model without drawing it. Security group wiring is real and useful to query, and ruinous to draw.
   */
  show?: boolean;
  label?: string;
}
