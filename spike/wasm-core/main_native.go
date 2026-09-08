//go:build !js || !wasm

package main

import (
	"encoding/json"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// The native entry point exists so the same analyzer can be exercised and
// timed without a browser. Browser numbers are the ones that count for the
// budgets, but native runs make iteration fast and give a baseline to compare
// the WASM overhead against.
func main() {
	dir := flag.String("dir", "testdata", "directory containing .tf files")
	iterations := flag.Int("n", 1, "number of runs to time")
	quiet := flag.Bool("quiet", false, "print timings only, not the model")
	flag.Parse()

	files, err := readTerraformDir(*dir)
	if err != nil {
		fmt.Fprintln(os.Stderr, "error:", err)
		os.Exit(1)
	}
	if len(files) == 0 {
		fmt.Fprintf(os.Stderr, "no .tf files found in %s\n", *dir)
		os.Exit(1)
	}

	var result Result
	durations := make([]time.Duration, 0, *iterations)
	for i := 0; i < *iterations; i++ {
		start := time.Now()
		result = Analyze(files)
		durations = append(durations, time.Since(start))
	}

	if !*quiet {
		b, _ := json.MarshalIndent(result, "", "  ")
		fmt.Println(string(b))
	}

	sort.Slice(durations, func(i, j int) bool { return durations[i] < durations[j] })
	p50 := durations[len(durations)*50/100]
	p95 := durations[min(len(durations)*95/100, len(durations)-1)]

	fmt.Fprintf(os.Stderr, "files=%d resources=%d diagnostics=%d truncated=%v\n",
		result.Stats.Files, result.Stats.Resources, len(result.Diagnostics), result.Stats.Truncated)
	fmt.Fprintf(os.Stderr, "runs=%d  p50=%v  p95=%v  min=%v  max=%v\n",
		*iterations, p50, p95, durations[0], durations[len(durations)-1])
}

func readTerraformDir(dir string) (map[string]string, error) {
	files := map[string]string{}
	err := filepath.WalkDir(dir, func(path string, d os.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if d.IsDir() {
			return nil
		}
		if !strings.HasSuffix(path, ".tf") {
			return nil
		}
		b, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		rel, err := filepath.Rel(dir, path)
		if err != nil {
			rel = path
		}
		files[filepath.ToSlash(rel)] = string(b)
		return nil
	})
	return files, err
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
