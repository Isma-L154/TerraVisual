// Package analyzer turns a workspace of Terraform files into an InfraModel.
//
// The real implementation lands in issue #7. What is here now is the boundary
// and its guarantees, because those are what the rest of the system is built
// against and what CI needs in order to have something meaningful to test.
package analyzer

import (
	"fmt"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// Analyze is the single entry point. It always returns a well-formed result:
// hostile or malformed input produces diagnostics, never a crash (NFR-7).
func Analyze(files map[string]string) model.Result {
	return recovered(func() model.Result {
		return analyze(files)
	})
}

func analyze(files map[string]string) model.Result {
	result := model.Empty()
	result.Stats.Files = len(files)
	result.Diagnostics = append(result.Diagnostics, model.Diagnostic{
		Severity: "info",
		Code:     "analyzer-not-implemented",
		Message:  "The analyzer is not implemented yet; no infrastructure was derived from this workspace.",
	})
	return result
}

// recovered turns a panic into a diagnostic.
//
// This is not defensive habit. The spike for issue #1 found that a panic
// crossing the WASM boundary takes the whole module down, after which every
// later keystroke fails too. Recovering keeps the session alive and tells the
// user something went wrong, which is the difference between a bug and an
// outage.
func recovered(fn func() model.Result) (result model.Result) {
	defer func() {
		if r := recover(); r != nil {
			result = model.Empty()
			result.Diagnostics = append(result.Diagnostics, model.Diagnostic{
				Severity: "error",
				Code:     "analyzer-panic",
				Message:  fmt.Sprintf("The analyzer failed unexpectedly: %v", r),
			})
		}
	}()
	return fn()
}
