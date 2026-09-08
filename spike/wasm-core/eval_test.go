package main

import "testing"

// The spike is exempt from the production testing standard, but the bug found
// while running it is worth pinning down: the locals fixpoint loop used a bound
// that shrank as locals resolved, so deep dependency chains were abandoned
// half-resolved and reported as unknown. A false "unknown" is nearly as
// damaging as a false value in a tool that sells honesty, so this test exists
// to make sure the production evaluator inherits the fix rather than the bug.
func TestDeepLocalsChainResolves(t *testing.T) {
	files := map[string]string{
		"main.tf": `
variable "env" {
  default = "staging"
}

locals {
  # Deliberately declared in reverse dependency order, five levels deep.
  e = upper(local.d)
  d = join("-", [local.c, "end"])
  c = jsonencode({ name = local.b })
  b = "${local.a}-${var.env}"
  a = lower("TerraVisual")
}

resource "test_thing" "x" {
  value = local.e
}
`,
	}

	res := Analyze(files)

	if len(res.Resources) != 1 {
		t.Fatalf("expected 1 resource, got %d", len(res.Resources))
	}
	attr, ok := res.Resources[0].Attributes["value"]
	if !ok {
		t.Fatal("resource has no 'value' attribute")
	}
	if !attr.Known {
		t.Fatalf("value should be determinable, got unknown: %s", attr.Reason)
	}
	want := `{"NAME":"TERRAVISUAL-STAGING"}-END`
	if got, _ := attr.Value.(string); got != want {
		t.Fatalf("value = %q, want %q", got, want)
	}
}

// A variable with no default is genuinely undeterminable. It must come back as
// unknown with a reason, never as an empty string (NFR-9).
func TestUndeterminableValueIsReportedNotGuessed(t *testing.T) {
	files := map[string]string{
		"main.tf": `
variable "email" {
  type = string
}

resource "test_thing" "x" {
  contact = upper(var.email)
}
`,
	}

	res := Analyze(files)
	attr := res.Resources[0].Attributes["contact"]
	if attr.Known {
		t.Fatalf("expected unknown, got value %v", attr.Value)
	}
	if attr.Reason == "" {
		t.Fatal("unknown value must carry a reason")
	}
}

// count expands into indexed instances, and count.index resolves inside them.
func TestCountExpansion(t *testing.T) {
	files := map[string]string{
		"main.tf": `
resource "test_thing" "x" {
  count = 3
  name  = "node-${count.index}"
}
`,
	}

	res := Analyze(files)
	if len(res.Resources) != 3 {
		t.Fatalf("expected 3 instances, got %d", len(res.Resources))
	}
	for i, r := range res.Resources {
		wantAddr := "test_thing.x[" + string(rune('0'+i)) + "]"
		if r.Address != wantAddr {
			t.Errorf("address = %q, want %q", r.Address, wantAddr)
		}
		if got, _ := r.Attributes["name"].Value.(string); got != "node-"+string(rune('0'+i)) {
			t.Errorf("instance %d name = %q", i, got)
		}
	}
}

// Hostile or accidental input must never take the analyzer down (NFR-7).
func TestBrokenInputStillReturnsDiagnostics(t *testing.T) {
	files := map[string]string{
		"broken.tf": `resource "test_thing" { unterminated = "`,
		"good.tf":   "resource \"test_thing\" \"ok\" {\n  value = 1\n}\n",
	}

	res := Analyze(files)
	if len(res.Diagnostics) == 0 {
		t.Fatal("expected diagnostics for malformed input")
	}
	// The valid file must still produce a resource: while the user types, most
	// files are broken most of the time, so partial output is the normal case.
	if len(res.Resources) == 0 {
		t.Fatal("a broken file blanked the whole model")
	}
}

// FuzzAnalyze asserts the property that matters: no input causes an
// uncontrolled failure. Go's native fuzzing was a real argument for choosing Go
// in ADR-0002, so the spike proves it is usable here.
func FuzzAnalyze(f *testing.F) {
	f.Add(`resource "a" "b" { x = 1 }`)
	f.Add(`locals { a = local.a }`)
	f.Add(`resource "a" "b" { count = 5 name = "${count.index}" }`)
	f.Add(`variable "v" {}`)
	f.Fuzz(func(t *testing.T, src string) {
		_ = Analyze(map[string]string{"fuzz.tf": src})
	})
}
