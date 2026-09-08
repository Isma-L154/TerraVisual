// Package catalog holds the per-provider domain knowledge that turns flat
// Terraform references into a nested diagram.
//
// This is the piece ADR-0004 exists for. Terraform has no concept of
// containment: `subnet_id = aws_subnet.public.id` is structurally identical to
// `kms_key_id = aws_kms_key.main.id`. Which of those means "lives inside" is a
// decision, and this is where the decision is recorded.
//
// The data lives in catalog/*.json at the repository root, embedded here by a
// generated file so both the analyzer and the interface read the same source.
package catalog

import (
	"encoding/json"
	"fmt"
	"sort"
)

// Entry describes one resource type: how to present it, what makes it a child
// of something else, and which of its references are worth drawing.
type Entry struct {
	Type             string       `json:"type"`
	Provider         string       `json:"provider"`
	Category         string       `json:"category"`
	DisplayName      string       `json:"displayName"`
	Icon             string       `json:"icon"`
	IsContainer      bool         `json:"isContainer"`
	ParentRules      []ParentRule `json:"parentRules"`
	EdgeRules        []EdgeRule   `json:"edgeRules"`
	LabelTemplate    string       `json:"labelTemplate"`
	DocumentationURL string       `json:"documentationUrl"`
}

// ParentRule names the attribute whose reference makes this resource a child.
// Lower priority wins, so a more specific placement beats a broader one: for
// an EC2 instance, the subnet it sits in beats the VPC that contains it.
type ParentRule struct {
	Attribute string `json:"attribute"`
	Priority  int    `json:"priority"`
}

// EdgeRule names a reference worth recording as a relationship. Show is false
// for relationships that are real and useful but ruinous to draw — security
// group wiring being the classic example.
type EdgeRule struct {
	Attribute string `json:"attribute"`
	Kind      string `json:"kind"`
	Show      *bool  `json:"show"`
	Label     string `json:"label"`
}

// Drawn reports whether this relationship should appear in the diagram.
// Absent means yes, which matches the schema default.
func (r EdgeRule) Drawn() bool {
	return r.Show == nil || *r.Show
}

type file struct {
	SchemaVersion int     `json:"schemaVersion"`
	Entries       []Entry `json:"entries"`
}

// Catalog is the loaded, indexed catalog.
type Catalog struct {
	byType map[string]Entry
}

var loaded *Catalog

// Load parses the embedded catalog files.
//
// It returns an error rather than panicking so a malformed catalog surfaces as
// a diagnostic the user can see, not as a dead module. In practice the tests
// catch this long before a user could, but "in practice" is not a guarantee.
func Load() (*Catalog, error) {
	if loaded != nil {
		return loaded, nil
	}

	names := make([]string, 0, len(rawCatalogs))
	for name := range rawCatalogs {
		names = append(names, name)
	}
	sort.Strings(names)

	byType := map[string]Entry{}
	for _, name := range names {
		var parsed file
		if err := json.Unmarshal([]byte(rawCatalogs[name]), &parsed); err != nil {
			return nil, fmt.Errorf("catalog %s: %w", name, err)
		}
		for _, entry := range parsed.Entries {
			if existing, duplicate := byType[entry.Type]; duplicate {
				return nil, fmt.Errorf(
					"catalog %s: %s is already defined for provider %s",
					name, entry.Type, existing.Provider)
			}
			// Sorting the rules here means every consumer gets priority order
			// without having to remember to sort.
			sort.SliceStable(entry.ParentRules, func(i, j int) bool {
				return entry.ParentRules[i].Priority < entry.ParentRules[j].Priority
			})
			byType[entry.Type] = entry
		}
	}

	loaded = &Catalog{byType: byType}
	return loaded, nil
}

// Lookup returns the entry for a resource type.
//
// The second return value is what the model records as `catalogued`. A type we
// do not know is not an error: a real project brings dozens of them, and they
// must still be drawn, marked honestly.
func (c *Catalog) Lookup(resourceType string) (Entry, bool) {
	entry, known := c.byType[resourceType]
	return entry, known
}

// Types lists every catalogued type, sorted. Used by tests and tooling.
func (c *Catalog) Types() []string {
	types := make([]string, 0, len(c.byType))
	for t := range c.byType {
		types = append(types, t)
	}
	sort.Strings(types)
	return types
}

// Entries lists every entry in type order.
func (c *Catalog) Entries() []Entry {
	types := c.Types()
	entries := make([]Entry, 0, len(types))
	for _, t := range types {
		entries = append(entries, c.byType[t])
	}
	return entries
}
