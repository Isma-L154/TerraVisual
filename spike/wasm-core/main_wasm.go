//go:build js && wasm

package main

import (
	"encoding/json"
	"fmt"
	"syscall/js"
)

// main registers the analyzer on the global scope and blocks forever, which is
// how a Go WASM module stays alive for repeated calls.
func main() {
	js.Global().Set("tvAnalyze", js.FuncOf(analyzeJS))
	js.Global().Set("tvReady", js.ValueOf(true))
	select {}
}

// analyzeJS takes an object of filename to source text and returns a JSON
// string.
//
// It recovers from panics on purpose. NFR-7 says no input may cause an
// uncontrolled failure, and a panic crossing the WASM boundary takes the whole
// module down — after which every later keystroke fails too. Turning it into a
// diagnostic keeps the session alive.
func analyzeJS(this js.Value, args []js.Value) (result any) {
	defer func() {
		if r := recover(); r != nil {
			result = fmt.Sprintf(
				`{"resources":[],"diagnostics":[{"severity":"error","summary":"analyzer panic","detail":%q,"source":{}}],"stats":{}}`,
				fmt.Sprint(r),
			)
		}
	}()

	if len(args) < 1 || args[0].Type() != js.TypeObject {
		return `{"resources":[],"diagnostics":[{"severity":"error","summary":"expected an object of filename to source"}],"stats":{}}`
	}

	files := map[string]string{}
	keys := js.Global().Get("Object").Call("keys", args[0])
	for i := 0; i < keys.Length(); i++ {
		k := keys.Index(i).String()
		files[k] = args[0].Get(k).String()
	}

	b, err := json.Marshal(Analyze(files))
	if err != nil {
		return fmt.Sprintf(
			`{"resources":[],"diagnostics":[{"severity":"error","summary":"could not serialise result","detail":%q}],"stats":{}}`,
			err.Error(),
		)
	}
	return string(b)
}
