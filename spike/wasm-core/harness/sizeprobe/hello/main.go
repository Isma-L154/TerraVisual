//go:build js && wasm

// Bare module: establishes the floor imposed by the Go runtime itself, so the
// rest of the size breakdown is measured against something real.
package main

import "syscall/js"

func main() {
	js.Global().Set("tvHello", js.FuncOf(func(this js.Value, args []js.Value) any {
		return "ok"
	}))
	select {}
}
