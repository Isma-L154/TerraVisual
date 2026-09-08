// Package model defines the InfraModel: the contract between analysis and
// presentation. The analyzer is its only producer; the layout, the diagram and
// the accessible tree are pure consumers.
//
// These types are a skeleton. Issue #2 formalises them against a JSON schema
// and generates the TypeScript counterpart from the same source, which is what
// keeps the two sides from drifting apart.
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
	ParentID   string               `json:"parentId,omitempty"`
	Unplaced   bool                 `json:"unplaced"`
	Catalogued bool                 `json:"catalogued"`
	Attributes map[string]Attribute `json:"attributes"`
	Source     Range                `json:"source"`
}

// Attribute makes NFR-9 structural: a value that could not be determined is
// reported as unknown with a reason. There is no ambiguous null or empty
// string standing in for "don't know", so the interface can always tell
// "empty" from "unknown".
type Attribute struct {
	Known  bool   `json:"known"`
	Value  any    `json:"value,omitempty"`
	Reason string `json:"reason,omitempty"`
}

type Edge struct {
	ID     string `json:"id"`
	From   string `json:"from"`
	To     string `json:"to"`
	Kind   string `json:"kind"`
	Source Range  `json:"source"`
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

// Empty returns a well-formed result with no content, so every code path can
// return something a consumer can render.
func Empty() Result {
	return Result{
		SchemaVersion: SchemaVersion,
		Nodes:         []Node{},
		Edges:         []Edge{},
		Diagnostics:   []Diagnostic{},
	}
}
