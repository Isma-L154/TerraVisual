// Package model defines the InfraModel: the contract between analysis and
// presentation. The analyzer is its only producer; the layout, the diagram and
// the accessible tree are pure consumers.
//
// The authoritative definition is schemas/infra-model.schema.json. These types
// are checked against it by TestModelConformsToSchema, and the TypeScript
// counterpart is generated from the same file. One source, two languages, and
// a test on each side to stop them drifting apart.
package model

// SchemaVersion travels with every result so consumers can refuse a model they
// do not understand instead of misreading it.
const SchemaVersion = 1

type Result struct {
	SchemaVersion int          `json:"schemaVersion"`
	Nodes         []Node       `json:"nodes"`
	Edges         []Edge       `json:"edges"`
	Diagnostics   []Diagnostic `json:"diagnostics"`
	Stats         Stats        `json:"stats"`
}

type Node struct {
	ID          string `json:"id"`
	Address     string `json:"address"`
	Type        string `json:"type"`
	Provider    string `json:"provider"`
	Category    string `json:"category"`
	Label       string `json:"label"`
	IsContainer bool   `json:"isContainer"`

	// ParentID is decided by the catalog, not by HCL: Terraform has no concept
	// of containment. See ADR-0004.
	ParentID string `json:"parentId,omitempty"`

	// Unplaced says containment could not be determined, so the interface can
	// group the node honestly instead of inventing a parent for it.
	Unplaced bool `json:"unplaced"`

	// Catalogued is false for resource types the catalog does not know. They
	// are still drawn, marked as such: a real project must never look empty,
	// nor look complete when it is not.
	Catalogued bool `json:"catalogued"`

	Attributes map[string]Attribute `json:"attributes"`
	Expansion  *Expansion           `json:"expansion,omitempty"`
	Source     Range                `json:"source"`
}

// Attribute makes NFR-9 structural: a value that could not be determined is
// reported as unknown with a reason. There is no ambiguous null or empty
// string standing in for "don't know", so the interface can always tell
// "empty" from "unknown".
type Attribute struct {
	Known bool `json:"known"`
	Value any  `json:"value,omitempty"`

	// Reason is written for a learner. "Depends on a data source, which needs
	// cloud credentials" teaches something; "unknown" does not.
	Reason string `json:"reason,omitempty"`
}

// Expansion is present when a node is one instance of a count or for_each block.
type Expansion struct {
	Kind      string `json:"kind"`
	Index     *int   `json:"index,omitempty"`
	Key       string `json:"key,omitempty"`
	Total     *int   `json:"total,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

type Edge struct {
	ID    string `json:"id"`
	From  string `json:"from"`
	To    string `json:"to"`
	Kind  string `json:"kind"`
	Label string `json:"label,omitempty"`
	Source Range `json:"source"`
}

type Diagnostic struct {
	Severity string `json:"severity"`
	Code     string `json:"code,omitempty"`
	Message  string `json:"message"`
	Source   Range  `json:"source"`
}

// Range is present on nodes, edges and diagnostics alike. It is what makes
// bidirectional code and diagram navigation possible (FR-11).
type Range struct {
	File      string `json:"file"`
	StartLine int    `json:"startLine"`
	StartCol  int    `json:"startCol"`
	EndLine   int    `json:"endLine"`
	EndCol    int    `json:"endCol"`
}

type Stats struct {
	Files      int `json:"files"`
	Resources  int `json:"resources"`
	DurationMs int `json:"durationMs"`

	// Truncated says a hard limit was reached, so the interface can say so
	// rather than quietly presenting a partial picture as a complete one.
	Truncated bool `json:"truncated"`
}

// Empty returns a well-formed result with no content.
//
// The slices are empty rather than nil deliberately: a nil slice marshals to
// JSON null, which every consumer would then have to guard against. Empty
// collections are part of the contract.
func Empty() Result {
	return Result{
		SchemaVersion: SchemaVersion,
		Nodes:         []Node{},
		Edges:         []Edge{},
		Diagnostics:   []Diagnostic{},
	}
}

// Unknown builds an attribute whose value could not be determined, with the
// reason the user will read. Constructing these through a function rather than
// by hand makes it hard to produce an unknown without saying why.
func Unknown(reason string) Attribute {
	return Attribute{Known: false, Reason: reason}
}

// Known builds an attribute with a determined value.
func Known(value any) Attribute {
	return Attribute{Known: true, Value: value}
}
