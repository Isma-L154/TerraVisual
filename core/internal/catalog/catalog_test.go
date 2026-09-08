package catalog_test

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/santhosh-tekuri/jsonschema/v6"

	"github.com/Isma-L154/TerraVisual/core/internal/catalog"
)

// The catalog is data, so it is tested like data. A wrong containment rule
// produces a confidently wrong diagram, which is worse than a missing one:
// the user has no reason to doubt it.

func TestCatalogFilesConformToSchema(t *testing.T) {
	schemaPath := filepath.Join("..", "..", "..", "schemas", "catalog-entry.schema.json")
	f, err := os.Open(schemaPath)
	if err != nil {
		t.Fatalf("opening schema: %v", err)
	}
	defer f.Close()

	doc, err := jsonschema.UnmarshalJSON(f)
	if err != nil {
		t.Fatalf("parsing schema: %v", err)
	}
	compiler := jsonschema.NewCompiler()
	if err := compiler.AddResource("catalog-entry.schema.json", doc); err != nil {
		t.Fatalf("adding schema: %v", err)
	}
	schema, err := compiler.Compile("catalog-entry.schema.json")
	if err != nil {
		t.Fatalf("compiling schema: %v", err)
	}

	dir := filepath.Join("..", "..", "..", "catalog")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading catalog directory: %v", err)
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
				t.Fatalf("reading catalog: %v", err)
			}
			var generic any
			if err := json.Unmarshal(raw, &generic); err != nil {
				t.Fatalf("catalog is not valid JSON: %v", err)
			}
			if err := schema.Validate(generic); err != nil {
				t.Errorf("catalog does not conform to the schema:\n%v", err)
			}
		})
	}

	if found == 0 {
		t.Fatal("no catalog files found")
	}
}

func TestCatalogLoads(t *testing.T) {
	c, err := catalog.Load()
	if err != nil {
		t.Fatalf("loading catalog: %v", err)
	}

	types := c.Types()
	if len(types) < 12 {
		t.Errorf("the AWS catalog should cover at least 12 resources, got %d", len(types))
	}
}

func TestEntriesAreInternallyConsistent(t *testing.T) {
	c, err := catalog.Load()
	if err != nil {
		t.Fatalf("loading catalog: %v", err)
	}

	providerPrefix := map[string]string{
		"aws":   "aws_",
		"azure": "azurerm_",
		"gcp":   "google_",
	}

	for _, entry := range c.Entries() {
		t.Run(entry.Type, func(t *testing.T) {
			// A type filed under the wrong provider would put the resource in
			// the wrong box on the diagram, which is the sort of error that
			// looks like a bug in the user's code rather than in ours.
			if prefix, known := providerPrefix[entry.Provider]; known {
				if !strings.HasPrefix(entry.Type, prefix) {
					t.Errorf("type %q is filed under provider %q but does not start with %q",
						entry.Type, entry.Provider, prefix)
				}
			}

			if !strings.HasPrefix(entry.Icon, entry.Provider+"/") {
				t.Errorf("icon %q should live under %q/", entry.Icon, entry.Provider)
			}

			if entry.DisplayName == "" {
				t.Error("every entry needs a display name: the raw type is not a label for a learner")
			}

			// Two rules with the same priority make the winner depend on file
			// order, which is not a decision anybody made.
			seen := map[int]string{}
			for _, rule := range entry.ParentRules {
				if other, clash := seen[rule.Priority]; clash {
					t.Errorf("parent rules %q and %q share priority %d", other, rule.Attribute, rule.Priority)
				}
				seen[rule.Priority] = rule.Attribute
			}

			// An attribute cannot both place a resource and describe a
			// relationship: the diagram would draw an edge to the box the node
			// already sits inside.
			parents := map[string]bool{}
			for _, rule := range entry.ParentRules {
				parents[rule.Attribute] = true
			}
			for _, rule := range entry.EdgeRules {
				if parents[rule.Attribute] {
					t.Errorf("%q is both a parent rule and an edge rule", rule.Attribute)
				}
			}
		})
	}
}

// The containment rules are the catalog's real content, so the important ones
// are asserted by name rather than left to a shape check.
func TestCoreContainmentRules(t *testing.T) {
	c, err := catalog.Load()
	if err != nil {
		t.Fatalf("loading catalog: %v", err)
	}

	cases := []struct {
		resourceType string
		attribute    string
		isContainer  bool
	}{
		{"aws_subnet", "vpc_id", true},
		{"aws_instance", "subnet_id", false},
		{"aws_security_group", "vpc_id", false},
		{"aws_nat_gateway", "subnet_id", false},
		{"aws_ecs_service", "cluster", false},
	}

	for _, tc := range cases {
		entry, known := c.Lookup(tc.resourceType)
		if !known {
			t.Errorf("%s is missing from the catalog", tc.resourceType)
			continue
		}
		if entry.IsContainer != tc.isContainer {
			t.Errorf("%s isContainer = %v, want %v", tc.resourceType, entry.IsContainer, tc.isContainer)
		}
		if len(entry.ParentRules) == 0 || entry.ParentRules[0].Attribute != tc.attribute {
			t.Errorf("%s should be placed by %q, got %+v", tc.resourceType, tc.attribute, entry.ParentRules)
		}
	}

	// A VPC is the outermost thing Terraform declares: nothing places it.
	if entry, _ := c.Lookup("aws_vpc"); len(entry.ParentRules) != 0 {
		t.Errorf("aws_vpc should have no parent rules, got %+v", entry.ParentRules)
	}
}

// Security group wiring is real, useful to record, and ruinous to draw. The
// catalog says so explicitly, and the test makes sure that stays deliberate.
func TestSecurityRelationshipsAreRecordedButNotDrawn(t *testing.T) {
	c, _ := catalog.Load()

	entry, known := c.Lookup("aws_instance")
	if !known {
		t.Fatal("aws_instance is missing from the catalog")
	}

	for _, rule := range entry.EdgeRules {
		if rule.Kind == "security" && rule.Drawn() {
			t.Errorf("%q is drawn; security wiring produces the tangle the product exists to avoid", rule.Attribute)
		}
	}
}

func TestUnknownTypeIsNotAnError(t *testing.T) {
	c, _ := catalog.Load()

	// A real project brings dozens of uncatalogued types. They must still be
	// drawable, so a lookup miss is an answer rather than a failure.
	if _, known := c.Lookup("some_exotic_thing"); known {
		t.Error("an uncatalogued type should not be reported as known")
	}
}
