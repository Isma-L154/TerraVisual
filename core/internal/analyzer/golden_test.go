package analyzer_test

import (
	"encoding/json"
	"flag"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/analyzer"
	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

var update = flag.Bool("update", false, "rewrite the expected models from the current output")

// Golden tests read a workspace from testdata/<case>/ and compare the whole
// model against expected.json.
//
// Unit tests say whether a rule works; these say whether the output as a whole
// is what we meant. They are also where a change shows its blast radius: a
// tweak to how unknowns are phrased shows up in every case at once, which is
// exactly the review you want before shipping it to learners.
func TestGolden(t *testing.T) {
	cases, err := os.ReadDir("testdata")
	if err != nil {
		t.Fatalf("reading testdata: %v", err)
	}

	found := 0
	for _, entry := range cases {
		if !entry.IsDir() {
			continue
		}
		found++

		t.Run(entry.Name(), func(t *testing.T) {
			dir := filepath.Join("testdata", entry.Name())
			files := readWorkspace(t, dir)

			result := analyzer.Analyze(files)

			// Duration is wall-clock and would make every run differ.
			result.Stats.DurationMs = 0

			got, err := json.MarshalIndent(result, "", "  ")
			if err != nil {
				t.Fatalf("marshalling result: %v", err)
			}
			got = append(got, '\n')

			expectedPath := filepath.Join(dir, "expected.json")
			if *update {
				if err := os.WriteFile(expectedPath, got, 0o644); err != nil {
					t.Fatalf("writing expected model: %v", err)
				}
				t.Logf("updated %s", expectedPath)
				return
			}

			want, err := os.ReadFile(expectedPath)
			if err != nil {
				t.Fatalf("reading expected model (run with -update to create it): %v", err)
			}

			if normalise(string(got)) != normalise(string(want)) {
				t.Errorf("model does not match %s\n\n--- got ---\n%s", expectedPath, got)
			}
		})
	}

	if found == 0 {
		t.Fatal("no golden cases found")
	}
}

func readWorkspace(t *testing.T, dir string) map[string]string {
	t.Helper()

	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("reading %s: %v", dir, err)
	}

	files := map[string]string{}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".tf") {
			continue
		}
		content, err := os.ReadFile(filepath.Join(dir, entry.Name()))
		if err != nil {
			t.Fatalf("reading %s: %v", entry.Name(), err)
		}
		files[entry.Name()] = string(content)
	}

	if len(files) == 0 {
		t.Fatalf("%s contains no .tf files", dir)
	}
	return files
}

// Line endings differ between the machine that wrote the file and the machine
// running the test. That is not a model difference and should not read as one.
func normalise(s string) string {
	return strings.ReplaceAll(s, "\r\n", "\n")
}

// The golden cases double as a check that the analyzer never emits an unknown
// without saying why, on realistic input rather than on fuzz noise.
func TestGoldenCasesExplainEveryUnknown(t *testing.T) {
	cases, _ := os.ReadDir("testdata")
	for _, entry := range cases {
		if !entry.IsDir() {
			continue
		}
		files := readWorkspace(t, filepath.Join("testdata", entry.Name()))
		result := analyzer.Analyze(files)

		for _, node := range result.Nodes {
			for name, attribute := range node.Attributes {
				if !attribute.Known && attribute.Reason == "" {
					t.Errorf("%s: %s.%s is unknown with no reason", entry.Name(), node.Address, name)
				}
			}
		}
		_ = model.SchemaVersion
	}
}
