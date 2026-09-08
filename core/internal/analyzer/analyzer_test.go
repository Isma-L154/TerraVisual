package analyzer

import (
	"strings"
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

func analyzeSource(t *testing.T, source string) model.Result {
	t.Helper()
	return Analyze(map[string]string{"main.tf": source})
}

func node(t *testing.T, result model.Result, address string) model.Node {
	t.Helper()
	for _, n := range result.Nodes {
		if n.Address == address {
			return n
		}
	}
	t.Fatalf("no node with address %q; got %d nodes", address, len(result.Nodes))
	return model.Node{}
}

func TestResultIsAlwaysWellFormed(t *testing.T) {
	result := analyzeSource(t, `resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }`)

	if result.SchemaVersion != model.SchemaVersion {
		t.Errorf("schemaVersion = %d, want %d", result.SchemaVersion, model.SchemaVersion)
	}
	// Nil slices marshal to JSON null, which every consumer would then have to
	// guard against. Empty collections are part of the contract.
	if result.Nodes == nil || result.Edges == nil || result.Diagnostics == nil {
		t.Error("result slices must be empty, never nil")
	}
}

func TestResolvesVariablesAndLocals(t *testing.T) {
	result := analyzeSource(t, `
variable "environment" {
  default = "staging"
}

locals {
  # Declared before what it depends on, to prove order does not matter.
  name    = "${local.project}-${var.environment}"
  project = lower("TerraVisual")
}

resource "aws_s3_bucket" "assets" {
  bucket = local.name
}
`)

	got := node(t, result, "aws_s3_bucket.assets").Attributes["bucket"]
	if !got.Known {
		t.Fatalf("bucket should be determinable, got unknown: %s", got.Reason)
	}
	if got.Value != "terravisual-staging" {
		t.Errorf("bucket = %v, want terravisual-staging", got.Value)
	}
}

// The spike found this the hard way: a fixpoint bound that shrinks as locals
// resolve abandons the deepest chains and reports determinable values as
// unknown. A false "unknown" is nearly as damaging as a false value.
func TestResolvesDeepLocalChains(t *testing.T) {
	result := analyzeSource(t, `
variable "env" { default = "prod" }

locals {
  e = upper(local.d)
  d = join("-", [local.c, "end"])
  c = jsonencode({ name = local.b })
  b = "${local.a}-${var.env}"
  a = lower("TerraVisual")
}

resource "test_thing" "x" {
  value = local.e
}
`)

	got := node(t, result, "test_thing.x").Attributes["value"]
	if !got.Known {
		t.Fatalf("a five-level chain should resolve, got unknown: %s", got.Reason)
	}
	if got.Value != `{"NAME":"TERRAVISUAL-PROD"}-END` {
		t.Errorf("value = %v", got.Value)
	}
}

func TestFunctionsFromEveryPackage(t *testing.T) {
	result := analyzeSource(t, `
resource "test_thing" "x" {
  from_stdlib_string     = upper("ok")
  from_stdlib_collection = join(",", sort(["b", "a"]))
  from_stdlib_encoding   = jsonencode({ a = 1 })
  from_cidr              = cidrsubnet("10.0.0.0/16", 8, 3)
  from_crypto            = sha256("terravisual")
  from_numbers           = max(3, 7, 5)
}
`)

	for name, want := range map[string]any{
		"from_stdlib_string":     "OK",
		"from_stdlib_collection": "a,b",
		"from_stdlib_encoding":   `{"a":1}`,
		"from_cidr":              "10.0.3.0/24",
		"from_numbers":           float64(7),
	} {
		got := node(t, result, "test_thing.x").Attributes[name]
		if !got.Known {
			t.Errorf("%s should be determinable: %s", name, got.Reason)
			continue
		}
		if got.Value != want {
			t.Errorf("%s = %v, want %v", name, got.Value, want)
		}
	}

	if got := node(t, result, "test_thing.x").Attributes["from_crypto"]; !got.Known {
		t.Errorf("sha256 should be determinable: %s", got.Reason)
	}
}

// Everything below is about the same rule stated four ways: when a value
// cannot be determined, say so, and say why in terms of the user's code.
func TestUnknownValuesExplainThemselves(t *testing.T) {
	result := analyzeSource(t, `
variable "operator_email" {}

data "aws_ami" "ubuntu" {}

resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_instance" "web" {
  ami           = data.aws_ami.ubuntu.id
  vpc_id        = aws_vpc.main.id
  alert_to      = var.operator_email
  from_disk     = file("user-data.sh")
  instance_type = "t3.micro"
}
`)

	instance := node(t, result, "aws_instance.web")

	cases := map[string]string{
		"ami":       "data source",
		"vpc_id":    "only determines when the infrastructure is created",
		"alert_to":  "no default value",
		"from_disk": "does not support",
	}
	for attribute, expected := range cases {
		got := instance.Attributes[attribute]
		if got.Known {
			t.Errorf("%s should be unknown, got %v", attribute, got.Value)
			continue
		}
		if !strings.Contains(got.Reason, expected) {
			t.Errorf("%s reason = %q, want it to mention %q", attribute, got.Reason, expected)
		}
	}

	// Everything else on the same resource must still resolve. One
	// undeterminable value must not poison its neighbours.
	if got := instance.Attributes["instance_type"]; !got.Known || got.Value != "t3.micro" {
		t.Errorf("instance_type = %+v, want a known t3.micro", got)
	}
}

// A reference is detected from the syntax, so it works even when the value is
// undeterminable — which is the common case, since most references point at
// attributes Terraform computes on apply.
func TestDetectsReferencesBetweenResources(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "main" { cidr_block = "10.0.0.0/16" }

resource "aws_subnet" "public" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "web" {
  subnet_id = aws_subnet.public.id
}
`)

	want := map[string]string{
		"aws_subnet.public": "aws_vpc.main",
		"aws_instance.web":  "aws_subnet.public",
	}
	found := map[string]string{}
	for _, edge := range result.Edges {
		found[edge.From] = edge.To
	}

	for from, to := range want {
		if found[from] != to {
			t.Errorf("expected an edge %s -> %s, got %q", from, to, found[from])
		}
	}
}

// Values one resource sets literally are visible to another. Terraform's own
// computed attributes are not, and must not be invented.
func TestResolvesLiteralValuesAcrossResources(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "public" {
  parent_cidr = aws_vpc.main.cidr_block
  parent_id   = aws_vpc.main.id
}
`)

	subnet := node(t, result, "aws_subnet.public")

	if got := subnet.Attributes["parent_cidr"]; !got.Known || got.Value != "10.0.0.0/16" {
		t.Errorf("parent_cidr = %+v, want a known 10.0.0.0/16", got)
	}
	if got := subnet.Attributes["parent_id"]; got.Known {
		t.Errorf("parent_id should be unknown: Terraform assigns it on apply, got %v", got.Value)
	}
}

// While the user is typing, most files are broken most of the time. A broken
// file must not blank the diagram for the ones that are fine.
func TestBrokenFileDoesNotBlankTheModel(t *testing.T) {
	result := Analyze(map[string]string{
		"broken.tf": `resource "aws_vpc" { unterminated = "`,
		"good.tf":   `resource "aws_s3_bucket" "assets" { bucket = "x" }`,
	})

	if len(result.Diagnostics) == 0 {
		t.Error("expected diagnostics for the malformed file")
	}
	if len(result.Nodes) == 0 {
		t.Fatal("the valid file's resource disappeared because another file was broken")
	}
	node(t, result, "aws_s3_bucket.assets")
}

func TestReportsWhatItSkipped(t *testing.T) {
	result := analyzeSource(t, `
module "network" {
  source = "./modules/network"
}

data "aws_region" "current" {}
`)

	codes := map[string]bool{}
	for _, d := range result.Diagnostics {
		codes[d.Code] = true
	}

	// Silence would be the worst outcome: a user whose infrastructure lives in
	// modules would see an empty diagram and no explanation for it.
	for _, code := range []string{"modules-not-supported", "data-source-not-resolved"} {
		if !codes[code] {
			t.Errorf("expected a %q diagnostic, got %v", code, codes)
		}
	}
}

func TestProviderIsDerivedOrLeftUnknown(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "a" {}
resource "azurerm_virtual_network" "b" {}
resource "google_compute_network" "c" {}
resource "wildly_custom_thing" "d" {}
`)

	want := map[string]string{
		"aws_vpc.a":                 "aws",
		"azurerm_virtual_network.b": "azure",
		"google_compute_network.c":  "gcp",
		"wildly_custom_thing.d":     "unknown",
	}
	for address, provider := range want {
		if got := node(t, result, address).Provider; got != provider {
			t.Errorf("%s provider = %q, want %q", address, got, provider)
		}
	}
}

// Until the catalog exists, every resource is honestly uncatalogued rather
// than guessed into a category.
func TestResourcesAreMarkedUncatalogued(t *testing.T) {
	result := analyzeSource(t, `resource "aws_vpc" "main" {}`)

	n := node(t, result, "aws_vpc.main")
	if n.Catalogued {
		t.Error("nothing is catalogued until the catalog is built")
	}
	if !n.Unplaced {
		t.Error("without containment rules a node cannot claim a place")
	}
}

func TestLimitsAreEnforcedAndReported(t *testing.T) {
	t.Run("file too large", func(t *testing.T) {
		result := Analyze(map[string]string{
			"huge.tf": strings.Repeat("# padding\n", (MaxFileBytes/10)+10),
			"ok.tf":   `resource "aws_vpc" "main" {}`,
		})

		if len(result.Nodes) != 1 {
			t.Errorf("the oversized file should be skipped and the rest analyzed, got %d nodes", len(result.Nodes))
		}
		if !hasCode(result, "file-too-large") {
			t.Error("skipping a file silently would present a partial analysis as a complete one")
		}
	})

	t.Run("too many files", func(t *testing.T) {
		files := map[string]string{}
		for i := 0; i < MaxFiles+50; i++ {
			files[padName(i)] = `resource "aws_vpc" "main" {}`
		}
		result := Analyze(files)

		if result.Stats.Files > MaxFiles {
			t.Errorf("accepted %d files, limit is %d", result.Stats.Files, MaxFiles)
		}
		if !hasCode(result, "too-many-files") {
			t.Error("dropping files must be reported")
		}
	})
}

func TestPanicBecomesADiagnostic(t *testing.T) {
	result := recovered(func() model.Result {
		panic("something went badly wrong")
	})

	if len(result.Diagnostics) != 1 || result.Diagnostics[0].Code != "analyzer-panic" {
		t.Fatalf("expected one analyzer-panic diagnostic, got %+v", result.Diagnostics)
	}
	if !strings.Contains(result.Diagnostics[0].Message, "something went badly wrong") {
		t.Error("the diagnostic should carry the cause")
	}
	if result.Nodes == nil {
		t.Error("a recovered result must still be well formed")
	}
}

// Identical input must produce identical output. Map iteration order would
// otherwise make node ordering, and therefore layout, vary between runs — and
// a diagram that reshuffles itself for no reason destroys the link between
// what was typed and what changed.
func TestOutputIsDeterministic(t *testing.T) {
	files := map[string]string{
		"a.tf": `resource "aws_vpc" "a" { cidr_block = "10.0.0.0/16" }`,
		"b.tf": `resource "aws_subnet" "b" { vpc_id = aws_vpc.a.id }`,
		"c.tf": `resource "aws_instance" "c" { subnet_id = aws_subnet.b.id }`,
	}

	first := Analyze(files)
	for i := 0; i < 5; i++ {
		again := Analyze(files)
		if len(again.Nodes) != len(first.Nodes) {
			t.Fatalf("node count varies between runs")
		}
		for j := range first.Nodes {
			if again.Nodes[j].Address != first.Nodes[j].Address {
				t.Fatalf("node order varies between runs: %s vs %s",
					first.Nodes[j].Address, again.Nodes[j].Address)
			}
		}
	}
}

func hasCode(result model.Result, code string) bool {
	for _, d := range result.Diagnostics {
		if d.Code == code {
			return true
		}
	}
	return false
}

func padName(i int) string {
	return "f" + itoa(i) + ".tf"
}

// FuzzAnalyze pins the property that matters on the only component that
// processes untrusted input: no input causes an uncontrolled failure (NFR-7).
func FuzzAnalyze(f *testing.F) {
	f.Add(`resource "a" "b" { x = 1 }`)
	f.Add(`locals { a = local.a }`)
	f.Add(`resource "a" "b" { count = 5 name = "${count.index}" }`)
	f.Add(`variable "v" {}`)
	f.Add(`data "d" "e" {} resource "a" "b" { x = data.d.e.id }`)
	f.Add(`locals { a = cidrsubnet("10.0.0.0/16", 8, 1) }`)
	f.Add("")

	f.Fuzz(func(t *testing.T, source string) {
		result := Analyze(map[string]string{"fuzz.tf": source})

		if result.Nodes == nil || result.Edges == nil || result.Diagnostics == nil {
			t.Fatal("analyzer returned a malformed result")
		}
		for _, n := range result.Nodes {
			for name, attribute := range n.Attributes {
				// The honesty rule, enforced on arbitrary input: an unknown
				// without a reason is a dead end for whoever reads it.
				if !attribute.Known && attribute.Reason == "" {
					t.Fatalf("attribute %q on %s is unknown with no reason", name, n.Address)
				}
			}
		}
	})
}
