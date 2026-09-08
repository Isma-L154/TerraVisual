package analyzer_test

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/analyzer"
)

var updateDocs = flag.Bool("update-docs", false, "rewrite the function coverage document")

const coveragePath = "../../../docs/reference/functions.md"

// The coverage document is generated from the function table itself.
//
// A hand-maintained list of what works would drift the first time somebody
// added a function in a hurry — and a coverage document that overstates
// coverage is worse than none, because a user would trust it.
func TestFunctionCoverageDocumentIsCurrent(t *testing.T) {
	generated := renderCoverage()

	path := filepath.Clean(coveragePath)
	if *updateDocs {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatalf("creating docs directory: %v", err)
		}
		if err := os.WriteFile(path, []byte(generated), 0o644); err != nil {
			t.Fatalf("writing coverage document: %v", err)
		}
		t.Logf("updated %s", path)
		return
	}

	existing, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("reading coverage document (run with -update-docs to create it): %v", err)
	}

	if normaliseNewlines(string(existing)) != normaliseNewlines(generated) {
		t.Error("docs/reference/functions.md no longer matches the function table.\n" +
			"Run: cd core && go test ./internal/analyzer -run TestFunctionCoverage -update-docs")
	}
}

func renderCoverage() string {
	supported := analyzer.SupportedFunctions()
	unsupported := analyzer.UnsupportedFunctions()

	names := make([]string, 0, len(unsupported))
	for name := range unsupported {
		names = append(names, name)
	}
	sort.Strings(names)

	var b strings.Builder
	b.WriteString(`<!-- Generated from the function table. Do not edit by hand.
     Run: cd core && go test ./internal/analyzer -run TestFunctionCoverage -update-docs -->

# Terraform function coverage

Terraform's own function library lives under ` + "`internal/`" + ` and cannot be
imported ([ADR-0002](../adr/0002-go-wasm-analysis-core.md)), so this table is
assembled from public packages — cty's standard library and
` + "`hashicorp/go-cty-funcs`" + ` — plus a handful written here where there was
nothing to borrow.

**Nothing is ever approximated.** A function that is not implemented reports
itself by name, with the reason, and the value becomes unknown. A subtly wrong
answer in a teaching tool teaches the wrong thing, which is worse than a gap
that says so.

`)

	fmt.Fprintf(&b, "## Supported (%d)\n\n", len(supported))
	for _, name := range supported {
		fmt.Fprintf(&b, "- `%s`\n", name)
	}

	b.WriteString("\n## Deliberately not supported\n\n")
	b.WriteString("Each of these is a decision rather than an omission.\n\n")
	b.WriteString("| Function | Why |\n|---|---|\n")
	for _, name := range names {
		fmt.Fprintf(&b, "| `%s` | %s |\n", name, unsupported[name])
	}

	b.WriteString(`
## Anything else

A function in neither list is one Terraform has and we have not reached. It
produces an evaluation error, and the attribute using it is reported as
unknown with the parser's own message.

That is the honest outcome, but it is a worse message than the table above
produces. Moving a function into the "not supported" list — with a reason a
learner can act on — is a small change and always an improvement, even when
implementing it is not yet possible.
`)

	return b.String()
}

func normaliseNewlines(s string) string {
	return strings.ReplaceAll(s, "\r\n", "\n")
}
