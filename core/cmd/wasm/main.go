//go:build js && wasm

// Command wasm is the boundary between the browser and the analyzer.
//
// It runs inside a Web Worker so that analysis never blocks typing (NFR-2),
// and so that a pathological input can be dealt with by terminating a
// disposable thread rather than the page.
package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"

	"github.com/Isma-L154/TerraVisual/core/internal/analyzer"
)

func main() {
	js.Global().Set("tvAnalyze", js.FuncOf(analyzeJS))
	js.Global().Set("tvSchemaVersion", js.ValueOf(schemaVersion))
	select {} // keep the module alive for repeated calls
}

// analyzeJS takes an object of filename to source text and returns a JSON
// string. It never throws: the analyzer already turns panics into diagnostics,
// and anything left over is caught here, because an exception crossing this
// boundary would take the module down for the rest of the session.
func analyzeJS(this js.Value, args []js.Value) (result any) {
	defer func() {
		if r := recover(); r != nil {
			result = errorResult(fmt.Sprintf("boundary failure: %v", r))
		}
	}()

	if len(args) < 1 || args[0].Type() != js.TypeObject {
		return errorResult("expected an object mapping filename to source text")
	}

	files := map[string]string{}
	keys := js.Global().Get("Object").Call("keys", args[0])
	for i := 0; i < keys.Length(); i++ {
		name := keys.Index(i).String()
		files[name] = args[0].Get(name).String()
	}

	encoded, err := json.Marshal(analyzer.Analyze(files))
	if err != nil {
		return errorResult("could not serialise the result: " + err.Error())
	}
	return string(encoded)
}

func errorResult(message string) string {
	encoded, _ := json.Marshal(map[string]any{
		"schemaVersion": schemaVersion,
		"nodes":         []any{},
		"edges":         []any{},
		"diagnostics": []map[string]any{{
			"severity": "error",
			"code":     "boundary-error",
			"message":  message,
		}},
		"stats": map[string]any{},
	})
	return string(encoded)
}
