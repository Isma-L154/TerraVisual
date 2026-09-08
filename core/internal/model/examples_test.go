package model_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

// The examples under schemas/examples/ are the shared contract fixtures: this
// test validates them against the schema, and the TypeScript tests import the
// same files typed as InfraModel. If the schema, the Go types and the
// generated TypeScript ever disagree, one of the two sides breaks — which is
// the whole reason the examples live in one place instead of being duplicated
// per language.
func TestExamplesConformToSchema(t *testing.T) {
	schema := compileSchema(t)

	dir := filepath.Join("..", "..", "..", "schemas", "examples")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading examples: %v", err)
	}

	found := 0
	for _, entry := range entries {
		if entry.IsDir() || filepath.Ext(entry.Name()) != ".json" {
			continue
		}
		found++

		t.Run(entry.Name(), func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(dir, entry.Name()))
			if err != nil {
				t.Fatalf("reading example: %v", err)
			}
			var generic any
			if err := json.Unmarshal(raw, &generic); err != nil {
				t.Fatalf("example is not valid JSON: %v", err)
			}
			if err := schema.Validate(generic); err != nil {
				t.Errorf("example does not conform to the schema:\n%v", err)
			}
		})
	}

	// An empty directory would make this test pass while proving nothing.
	if found == 0 {
		t.Fatal("no examples found; the shared contract fixtures are missing")
	}
}
