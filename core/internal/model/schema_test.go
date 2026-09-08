package model_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

const schemaPath = "../../../schemas/infra-model.schema.json"

func compileSchema(t *testing.T) *jsonschema.Schema {
	t.Helper()

	abs, err := filepath.Abs(schemaPath)
	if err != nil {
		t.Fatalf("resolving schema path: %v", err)
	}
	f, err := os.Open(abs)
	if err != nil {
		t.Fatalf("opening schema: %v", err)
	}
	defer f.Close()

	doc, err := jsonschema.UnmarshalJSON(f)
	if err != nil {
		t.Fatalf("parsing schema: %v", err)
	}

	c := jsonschema.NewCompiler()
	if err := c.AddResource("infra-model.schema.json", doc); err != nil {
		t.Fatalf("adding schema: %v", err)
	}
	schema, err := c.Compile("infra-model.schema.json")
	if err != nil {
		t.Fatalf("compiling schema: %v", err)
	}
	return schema
}

func validate(t *testing.T, schema *jsonschema.Schema, value any) error {
	t.Helper()

	encoded, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshalling: %v", err)
	}
	var generic any
	if err := json.Unmarshal(encoded, &generic); err != nil {
		t.Fatalf("round-tripping: %v", err)
	}
	return schema.Validate(generic)
}

// The Go types are the producer side of the contract. If they can emit
// something the schema rejects, the TypeScript side will be handed data its
// generated types say is impossible.
func TestModelConformsToSchema(t *testing.T) {
	schema := compileSchema(t)

	index := 0
	total := 3
	result := model.Result{
		SchemaVersion: model.SchemaVersion,
		Nodes: []model.Node{
			{
				ID:          "aws_vpc.main",
				Address:     "aws_vpc.main",
				Type:        "aws_vpc",
				Provider:    "aws",
				Category:    "network",
				Label:       "main",
				IsContainer: true,
				Unplaced:    false,
				Catalogued:  true,
				Attributes: map[string]model.Attribute{
					"cidr_block": model.Known("10.0.0.0/16"),
				},
				Source: model.Range{File: "main.tf", StartLine: 1, StartCol: 1, EndLine: 3, EndCol: 2},
			},
			{
				ID:         "aws_instance.web[0]",
				Address:    "aws_instance.web[0]",
				Type:       "aws_instance",
				Provider:   "aws",
				Category:   "compute",
				Label:      "web",
				ParentID:   "aws_vpc.main",
				Catalogued: true,
				Attributes: map[string]model.Attribute{
					"ami": model.Unknown("depends on a data source, which needs cloud credentials"),
				},
				Expansion: &model.Expansion{Kind: "count", Index: &index, Total: &total},
				Source:    model.Range{File: "main.tf", StartLine: 5, StartCol: 1, EndLine: 9, EndCol: 2},
			},
			{
				// An uncatalogued type must still be representable. A real
				// project brings dozens of these.
				ID:         "some_exotic_thing.x",
				Address:    "some_exotic_thing.x",
				Type:       "some_exotic_thing",
				Provider:   "unknown",
				Category:   "other",
				Label:      "x",
				Unplaced:   true,
				Catalogued: false,
				Attributes: map[string]model.Attribute{},
				Source:     model.Range{File: "main.tf", StartLine: 11, StartCol: 1, EndLine: 12, EndCol: 2},
			},
		},
		Edges: []model.Edge{{
			ID:     "e1",
			From:   "aws_lb.front",
			To:     "aws_instance.web[0]",
			Kind:   "traffic",
			Source: model.Range{File: "lb.tf", StartLine: 4, StartCol: 3, EndLine: 4, EndCol: 40},
		}},
		Diagnostics: []model.Diagnostic{{
			Severity: "warning",
			Code:     "unresolved-value",
			Message:  "The value of 'ami' depends on a data source and cannot be determined here.",
			Source:   model.Range{File: "main.tf", StartLine: 6, StartCol: 3, EndLine: 6, EndCol: 20},
		}},
		Stats: model.Stats{Files: 2, Resources: 3, DurationMs: 41},
	}

	if err := validate(t, schema, result); err != nil {
		t.Fatalf("a model the Go types can produce is rejected by the schema:\n%v", err)
	}
}

func TestEmptyResultConformsToSchema(t *testing.T) {
	schema := compileSchema(t)

	if err := validate(t, schema, model.Empty()); err != nil {
		t.Fatalf("the empty result must be valid, since every failure path returns it:\n%v", err)
	}
}

// A schema that accepts anything is not a validation boundary. Shared links
// (issue #20) deserialise untrusted data into this shape, so the rejections
// matter as much as the acceptances.
func TestSchemaRejectsMalformedModels(t *testing.T) {
	schema := compileSchema(t)

	cases := map[string]string{
		"unknown top-level property": `{"schemaVersion":1,"nodes":[],"edges":[],"diagnostics":[],"stats":{"files":0,"resources":0,"durationMs":0,"truncated":false},"surprise":true}`,
		"wrong schema version":       `{"schemaVersion":99,"nodes":[],"edges":[],"diagnostics":[],"stats":{"files":0,"resources":0,"durationMs":0,"truncated":false}}`,
		"missing stats":              `{"schemaVersion":1,"nodes":[],"edges":[],"diagnostics":[]}`,
		"node without attributes":    `{"schemaVersion":1,"nodes":[{"id":"a","address":"a","type":"t","provider":"aws","category":"compute","label":"a","isContainer":false,"unplaced":false,"catalogued":true,"source":{"file":"f","startLine":1,"startCol":1,"endLine":1,"endCol":2}}],"edges":[],"diagnostics":[],"stats":{"files":0,"resources":0,"durationMs":0,"truncated":false}}`,
		"invalid severity":           `{"schemaVersion":1,"nodes":[],"edges":[],"diagnostics":[{"severity":"catastrophe","message":"x","source":{"file":"f","startLine":1,"startCol":1,"endLine":1,"endCol":2}}],"stats":{"files":0,"resources":0,"durationMs":0,"truncated":false}}`,
		"diagnostic code in prose":   `{"schemaVersion":1,"nodes":[],"edges":[],"diagnostics":[{"severity":"error","code":"Not A Code","message":"x","source":{"file":"f","startLine":1,"startCol":1,"endLine":1,"endCol":2}}],"stats":{"files":0,"resources":0,"durationMs":0,"truncated":false}}`,
		"negative line number":       `{"schemaVersion":1,"nodes":[],"edges":[],"diagnostics":[{"severity":"error","message":"x","source":{"file":"f","startLine":-1,"startCol":1,"endLine":1,"endCol":2}}],"stats":{"files":0,"resources":0,"durationMs":0,"truncated":false}}`,
	}

	for name, raw := range cases {
		t.Run(name, func(t *testing.T) {
			var generic any
			if err := json.Unmarshal([]byte(raw), &generic); err != nil {
				t.Fatalf("test fixture is not valid JSON: %v", err)
			}
			if err := schema.Validate(generic); err == nil {
				t.Error("the schema accepted a model it should have rejected")
			}
		})
	}
}
