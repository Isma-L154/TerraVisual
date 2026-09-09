package analyzer

import (
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"testing"
	"time"
)

// The reference workspaces, shared with the browser measurements so the two
// sets of numbers describe the same input. They are committed rather than
// generated here: a benchmark whose input changes is a benchmark whose history
// means nothing.
var fixtureSizes = []int{50, 200, 1000}

func fixture(tb testing.TB, size int) map[string]string {
	tb.Helper()

	path := filepath.Join("..", "..", "..", "fixtures", "perf", fmt.Sprintf("%d.tf", size))
	content, err := os.ReadFile(path)
	if err != nil {
		tb.Fatalf("reading %s: %v (run: node scripts/make-perf-fixtures.mjs)", path, err)
	}

	return map[string]string{"main.tf": string(content)}
}

func BenchmarkAnalyze(b *testing.B) {
	for _, size := range fixtureSizes {
		files := fixture(b, size)

		b.Run(fmt.Sprintf("%d_resources", size), func(b *testing.B) {
			b.ReportAllocs()
			for b.Loop() {
				Analyze(files)
			}
		})
	}
}

// The budget is stated as a p95, not as an average, because the number a user
// notices is the slow one. Go's benchmark output reports a mean, so the
// distribution is measured here instead.
//
// Skipped by default: it takes seconds and asserts a wall-clock budget, which
// belongs in a deliberate run rather than in every `go test ./...`. Run it with
// `go test ./internal/analyzer -run TestAnalysisLatency -v -timing`.
func TestAnalysisLatency(t *testing.T) {
	if !*timing {
		t.Skip("pass -timing to measure analysis latency")
	}

	budgets := map[int]time.Duration{
		50:   100 * time.Millisecond,
		200:  300 * time.Millisecond, // NFR-4
		1000: time.Second,            // NFR-4
	}

	for _, size := range fixtureSizes {
		files := fixture(t, size)

		// Warm up, so the first measurement is not paying for lazily
		// initialised state that every later analysis gets for free.
		for range 3 {
			Analyze(files)
		}

		const runs = 50
		samples := make([]time.Duration, 0, runs)
		var resources int

		for range runs {
			start := time.Now()
			result := Analyze(files)
			samples = append(samples, time.Since(start))
			resources = result.Stats.Resources
		}

		sort.Slice(samples, func(i, j int) bool { return samples[i] < samples[j] })
		p50 := samples[len(samples)/2]
		p95 := samples[(len(samples)*95)/100]
		worst := samples[len(samples)-1]

		t.Logf("%4d blocks -> %4d resources: p50 %6.2f ms  p95 %6.2f ms  max %6.2f ms  (budget %v)",
			size, resources,
			float64(p50.Microseconds())/1000,
			float64(p95.Microseconds())/1000,
			float64(worst.Microseconds())/1000,
			budgets[size])

		if budget, ok := budgets[size]; ok && p95 > budget {
			t.Errorf("%d resources: p95 %v exceeds the budget of %v", size, p95, budget)
		}
	}
}

// A flag rather than an environment variable so it shows up in `go test -h`
// for this package, next to the test it gates.
var timing = flag.Bool("timing", false, "measure analysis latency against the NFR-4 budgets")
