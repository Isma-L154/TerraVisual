package analyzer

import (
	"fmt"
	"strings"
	"testing"
)

// evalExpression evaluates a single expression by putting it in a resource
// attribute, which is the only way a user ever reaches these functions.
func evalExpression(t *testing.T, expression string) (any, bool, string) {
	t.Helper()

	source := fmt.Sprintf("resource \"test_thing\" \"x\" {\n  value = %s\n}\n", expression)
	result := Analyze(map[string]string{"main.tf": source})

	for _, node := range result.Nodes {
		if node.Address != "test_thing.x" {
			continue
		}
		attribute := node.Attributes["value"]
		return attribute.Value, attribute.Known, attribute.Reason
	}
	t.Fatalf("no node produced for %q", expression)
	return nil, false, ""
}

func assertValue(t *testing.T, expression string, want any) {
	t.Helper()

	value, known, reason := evalExpression(t, expression)
	if !known {
		t.Errorf("%s should be determinable, got unknown: %s", expression, reason)
		return
	}
	if fmt.Sprint(value) != fmt.Sprint(want) {
		t.Errorf("%s = %v, want %v", expression, value, want)
	}
}

// One case per function, because a function table is only as good as the
// answers it gives. A table this size is easy to add to and easy to get subtly
// wrong, and "it compiled" is not evidence.
func TestBorrowedFunctions(t *testing.T) {
	cases := map[string]any{
		// strings
		`upper("ok")`:                         "OK",
		`lower("OK")`:                         "ok",
		`title("hello world")`:                "Hello World",
		`trimspace("  x  ")`:                  "x",
		`trimprefix("terravisual", "terra")`:  "visual",
		`trimsuffix("terravisual", "visual")`: "terra",
		`replace("a-b", "-", "_")`:            "a_b",
		`join(",", ["a", "b"])`:               "a,b",
		`substr("terravisual", 0, 5)`:         "terra",
		`format("%s-%d", "web", 3)`:           "web-3",
		`indent(2, "x")`:                      "x",
		`chomp("x\n")`:                        "x",
		`strrev("abc")`:                       "cba",
		`regex("[0-9]+", "abc123")`:           "123",

		// numbers
		`abs(-3)`:            float64(3),
		`ceil(1.1)`:          float64(2),
		`floor(1.9)`:         float64(1),
		`max(1, 7, 3)`:       float64(7),
		`min(1, 7, 3)`:       float64(1),
		`pow(2, 10)`:         float64(1024),
		`signum(-4)`:         float64(-1),
		`parseint("ff", 16)`: float64(255),

		// collections
		`length(["a", "b"])`:                     float64(2),
		`element(["a", "b", "c"], 1)`:            "b",
		`join("", distinct(["a", "a"]))`:         "a",
		`join("", sort(["b", "a"]))`:             "ab",
		`join("", reverse(["a", "b"]))`:          "ba",
		`join("", compact(["a", "", "b"]))`:      "ab",
		`join("", flatten([["a"], ["b"]]))`:      "ab",
		`contains(["a"], "a")`:                   true,
		`join("", keys({ b = 1, a = 2 }))`:       "ab",
		`join("", slice(["a", "b", "c"], 0, 2))`: "ab",

		// encoding
		`jsonencode({ a = 1 })`: `{"a":1}`,
		`base64encode("x")`:     "eA==",
		`base64decode("eA==")`:  "x",

		// networking
		`cidrsubnet("10.0.0.0/16", 8, 3)`: "10.0.3.0/24",
		`cidrhost("10.0.0.0/24", 5)`:      "10.0.0.5",
		`cidrnetmask("10.0.0.0/24")`:      "255.255.255.0",

		// crypto
		`md5("")`:  "d41d8cd98f00b204e9800998ecf8427e",
		`sha1("")`: "da39a3ee5e6b4b0d3255bfef95601890afd80709",
	}

	for expression, want := range cases {
		assertValue(t, expression, want)
	}
}

// The ones implemented here rather than borrowed. Each was written because its
// semantics are simple enough to be obviously right; these tests are what
// makes "obviously" mean something.
func TestOwnFunctions(t *testing.T) {
	assertValue(t, `sum([1, 2, 3])`, float64(6))
	assertValue(t, `startswith("terravisual", "terra")`, true)
	assertValue(t, `startswith("terravisual", "visual")`, false)
	assertValue(t, `endswith("terravisual", "visual")`, true)
	assertValue(t, `strcontains("terravisual", "rav")`, true)
	assertValue(t, `strcontains("terravisual", "zzz")`, false)
	assertValue(t, `one(["only"])`, "only")
	assertValue(t, `coalesce("", "second")`, "second")
	assertValue(t, `join("", transpose({ a = ["x"] })["x"])`, "a")

	// The edge cases people get backwards when reimplementing these.
	t.Run("alltrue of nothing is true", func(t *testing.T) {
		assertValue(t, `alltrue([])`, true)
	})
	t.Run("anytrue of nothing is false", func(t *testing.T) {
		assertValue(t, `anytrue([])`, false)
	})
	t.Run("alltrue stops at the first false", func(t *testing.T) {
		assertValue(t, `alltrue([true, false, true])`, false)
	})
	t.Run("anytrue stops at the first true", func(t *testing.T) {
		assertValue(t, `anytrue([false, true])`, true)
	})
	// Terraform's coalesce treats an empty string as absent, which is the part
	// most reimplementations get wrong.
	t.Run("coalesce skips empty strings, not just nulls", func(t *testing.T) {
		assertValue(t, `coalesce("", "", "third")`, "third")
	})
}

// The expression language itself, not the functions.
func TestExpressionForms(t *testing.T) {
	assertValue(t, `true ? "yes" : "no"`, "yes")
	assertValue(t, `join("", [for x in ["a", "b"] : upper(x)])`, "AB")
	assertValue(t, `join("", [for k, v in { a = 1 } : k])`, "a")
	assertValue(t, `length({ for k, v in { a = 1, b = 2 } : k => v if v > 1 })`, float64(1))
	assertValue(t, `join("", [{ name = "a" }, { name = "b" }][*].name)`, "ab")
	assertValue(t, `"${upper("a")}-${lower("B")}"`, "A-b")
	assertValue(t, `[1, 2, 3][1]`, float64(2))
	assertValue(t, `{ a = 1 }["a"]`, float64(1))
}

// A function we do not implement must say so by name, with the reason. An
// obscure parser error would leave the user guessing whether they had made a
// mistake.
func TestUnsupportedFunctionsSayWhy(t *testing.T) {
	for name, reason := range UnsupportedFunctions() {
		t.Run(name, func(t *testing.T) {
			_, known, message := evalExpression(t, name+`("x")`)

			if known {
				t.Fatalf("%s is listed as unsupported but produced a value", name)
			}
			if !strings.Contains(message, name) {
				t.Errorf("the message should name the function, got %q", message)
			}
			if !strings.Contains(message, reason) {
				t.Errorf("the message should carry the reason %q, got %q", reason, message)
			}
		})
	}
}

// A function cannot be both supported and unsupported: whichever list is wrong,
// the user gets a confusing answer.
func TestNoFunctionIsInBothTables(t *testing.T) {
	unsupported := UnsupportedFunctions()

	for _, name := range SupportedFunctions() {
		if _, clash := unsupported[name]; clash {
			t.Errorf("%s is listed as both supported and unsupported", name)
		}
	}
}

func TestCoverageIsSubstantial(t *testing.T) {
	// Not a target to game, a floor to notice falling through. The spike
	// measured that functions cost nothing in binary size, so coverage here is
	// limited by care rather than by bytes.
	if count := len(SupportedFunctions()); count < 60 {
		t.Errorf("only %d functions are supported; the table has shrunk", count)
	}
}
