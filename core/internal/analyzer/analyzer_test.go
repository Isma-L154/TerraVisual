package analyzer

import (
	"strings"
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

func TestAnalyzeAlwaysReturnsAWellFormedResult(t *testing.T) {
	result := Analyze(map[string]string{"main.tf": "resource \"a\" \"b\" {}"})

	if result.SchemaVersion != model.SchemaVersion {
		t.Errorf("schemaVersion = %d, want %d", result.SchemaVersion, model.SchemaVersion)
	}
	// Nil slices serialise to JSON null, which every consumer would then have
	// to guard against. Empty slices are part of the contract.
	if result.Nodes == nil || result.Edges == nil || result.Diagnostics == nil {
		t.Error("result slices must be empty, never nil")
	}
	if result.Stats.Files != 1 {
		t.Errorf("stats.files = %d, want 1", result.Stats.Files)
	}
}

// A panic must become a diagnostic, not an outage. The spike for issue #1
// showed that a panic crossing the WASM boundary kills the module and every
// subsequent call with it.
func TestPanicBecomesADiagnostic(t *testing.T) {
	result := recovered(func() model.Result {
		panic("something went badly wrong")
	})

	if len(result.Diagnostics) != 1 {
		t.Fatalf("expected 1 diagnostic, got %d", len(result.Diagnostics))
	}
	d := result.Diagnostics[0]
	if d.Severity != "error" || d.Code != "analyzer-panic" {
		t.Errorf("diagnostic = %+v, want an analyzer-panic error", d)
	}
	if !strings.Contains(d.Message, "something went badly wrong") {
		t.Errorf("message should carry the cause, got %q", d.Message)
	}
	if result.Nodes == nil {
		t.Error("a recovered result must still be well formed")
	}
}

// FuzzAnalyze pins the property that matters on the component that will process
// untrusted input: no input causes an uncontrolled failure (NFR-7).
func FuzzAnalyze(f *testing.F) {
	f.Add(`resource "a" "b" { x = 1 }`)
	f.Add(`locals { a = local.a }`)
	f.Add("")
	f.Fuzz(func(t *testing.T, src string) {
		result := Analyze(map[string]string{"fuzz.tf": src})
		if result.Nodes == nil || result.Diagnostics == nil {
			t.Fatal("analyzer returned a malformed result")
		}
	})
}
