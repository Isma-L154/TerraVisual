package analyzer

import (
	"fmt"
	"strings"
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

func addresses(result model.Result) []string {
	var out []string
	for _, node := range result.Nodes {
		if !isSynthetic(node.ID) {
			out = append(out, node.Address)
		}
	}
	return out
}

func TestCountExpandsIntoInstances(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_instance" "web" {
  count = 3

  name = "node-${count.index}"
}
`)

	got := addresses(result)
	want := []string{"aws_instance.web[0]", "aws_instance.web[1]", "aws_instance.web[2]"}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("addresses = %v, want %v", got, want)
	}

	// Each instance evaluates in its own scope, so count.index differs.
	for i, address := range want {
		attribute := node(t, result, address).Attributes["name"]
		if !attribute.Known {
			t.Errorf("%s name should be determinable: %s", address, attribute.Reason)
			continue
		}
		if attribute.Value != fmt.Sprintf("node-%d", i) {
			t.Errorf("%s name = %v", address, attribute.Value)
		}
	}
}

func TestCountRecordsWhichInstanceAndHowMany(t *testing.T) {
	result := analyzeSource(t, `resource "aws_instance" "web" { count = 2 }`)

	first := node(t, result, "aws_instance.web[0]")
	if first.Expansion == nil {
		t.Fatal("an expanded instance must record its expansion")
	}
	if first.Expansion.Kind != "count" || first.Expansion.Index == nil || *first.Expansion.Index != 0 {
		t.Errorf("expansion = %+v", first.Expansion)
	}
	if first.Expansion.Total == nil || *first.Expansion.Total != 2 {
		t.Errorf("total = %+v, want 2", first.Expansion.Total)
	}
}

func TestForEachExpandsByKey(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_subnet" "tier" {
  for_each = {
    public  = "10.0.1.0/24"
    private = "10.0.2.0/24"
  }

  name       = each.key
  cidr_block = each.value
}
`)

	// Keys are sorted, so the same configuration always produces the same
	// order. A map's iteration order would reshuffle the diagram between
	// identical runs.
	got := addresses(result)
	want := []string{`aws_subnet.tier["private"]`, `aws_subnet.tier["public"]`}
	if fmt.Sprint(got) != fmt.Sprint(want) {
		t.Fatalf("addresses = %v, want %v", got, want)
	}

	private := node(t, result, `aws_subnet.tier["private"]`)
	if got := private.Attributes["cidr_block"]; !got.Known || got.Value != "10.0.2.0/24" {
		t.Errorf("each.value did not resolve per instance: %+v", got)
	}
	if got := private.Attributes["name"]; !got.Known || got.Value != "private" {
		t.Errorf("each.key did not resolve per instance: %+v", got)
	}
	if private.Expansion == nil || private.Expansion.Key != "private" {
		t.Errorf("expansion = %+v", private.Expansion)
	}
}

func TestForEachOverASetUsesTheElementAsTheKey(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_subnet" "tier" {
  for_each = toset(["a", "b"])

  name = each.key
}
`)

	if got := addresses(result); len(got) != 2 {
		t.Fatalf("expected two instances, got %v", got)
	}
}

// Showing one box and saying "we do not know how many" is honest. Showing
// three because three looked plausible is not.
func TestUndeterminableCountProducesOneHonestInstance(t *testing.T) {
	result := analyzeSource(t, `
variable "size" {}

resource "aws_instance" "web" {
  count = var.size
}
`)

	got := addresses(result)
	if len(got) != 1 || got[0] != "aws_instance.web" {
		t.Fatalf("addresses = %v, want a single unindexed instance", got)
	}

	instance := node(t, result, "aws_instance.web")
	if instance.Expansion == nil || instance.Expansion.Kind != "count" {
		t.Errorf("the instance should still record that it is a count block: %+v", instance.Expansion)
	}
	if instance.Expansion != nil && instance.Expansion.Total != nil {
		t.Error("an undeterminable count must not report a total")
	}
	if !hasCode(result, "expansion-not-determinable") {
		t.Error("the user should be told why the number is unknown")
	}
}

// This is security control 3 in practice: count = 100000 is a plausible typo,
// and with no server, the browser tab is what an accident can exhaust.
func TestExpansionIsCappedAndSaysSo(t *testing.T) {
	result := analyzeSource(t, fmt.Sprintf(`
resource "aws_instance" "swarm" {
  count = %d
}
`, MaxInstancesPerResource*10))

	if count := len(addresses(result)); count != MaxInstancesPerResource {
		t.Errorf("produced %d instances, cap is %d", count, MaxInstancesPerResource)
	}
	if !hasCode(result, "expansion-truncated") {
		t.Error("truncation must be reported, not applied silently")
	}
	if !result.Stats.Truncated {
		t.Error("stats must say the picture is partial")
	}

	first := node(t, result, "aws_instance.swarm[0]")
	if first.Expansion == nil || !first.Expansion.Truncated {
		t.Error("each instance should carry the truncation flag")
	}
	// The real total is still reported, so the interface can say "1000 of
	// 10000" rather than implying there are only a thousand.
	if first.Expansion != nil && (first.Expansion.Total == nil || *first.Expansion.Total != MaxInstancesPerResource*10) {
		t.Errorf("total = %+v, want the declared count", first.Expansion.Total)
	}
}

func TestInvalidExpansionIsAnError(t *testing.T) {
	t.Run("both count and for_each", func(t *testing.T) {
		result := analyzeSource(t, `
resource "aws_instance" "web" {
  count    = 2
  for_each = { a = 1 }
}
`)
		if !hasCode(result, "count-and-for-each") {
			t.Error("Terraform allows only one; saying so is more useful than picking one")
		}
	})

	t.Run("negative count", func(t *testing.T) {
		result := analyzeSource(t, `resource "aws_instance" "web" { count = -1 }`)

		if !hasCode(result, "invalid-count") {
			t.Error("a negative count is a mistake in the user's code, not an unknown")
		}
	})

	t.Run("for_each over a string", func(t *testing.T) {
		result := analyzeSource(t, `resource "aws_instance" "web" { for_each = "nope" }`)

		if !hasCode(result, "invalid-for-each") {
			t.Error("for_each must be a map or a set of strings")
		}
	})
}

func TestZeroCountProducesNothing(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_instance" "web" { count = 0 }
resource "aws_vpc" "main" {}
`)

	for _, address := range addresses(result) {
		if strings.HasPrefix(address, "aws_instance.web") {
			t.Errorf("count = 0 should produce no instances, got %s", address)
		}
	}
	node(t, result, "aws_vpc.main")
}

// Terraform sees a count block as a list, so an index into it must resolve.
// Publishing only the first instance would make the others silently unknown.
func TestReferencesIntoExpandedResources(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_subnet" "tier" {
  count      = 2
  cidr_block = "10.0.${count.index}.0/24"
}

resource "aws_instance" "web" {
  from_second = aws_subnet.tier[1].cidr_block
}
`)

	got := node(t, result, "aws_instance.web").Attributes["from_second"]
	if !got.Known {
		t.Fatalf("an index into an expanded resource should resolve: %s", got.Reason)
	}
	if got.Value != "10.0.1.0/24" {
		t.Errorf("from_second = %v, want the second instance's value", got.Value)
	}
}

// A reference names a resource, not an instance. Containment has to pick one,
// and the first in address order is stable.
func TestContainmentPicksAnInstanceOfAnExpandedParent(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "main" {}

resource "aws_subnet" "tier" {
  count  = 2
  vpc_id = aws_vpc.main.id
}

resource "aws_instance" "web" {
  subnet_id = aws_subnet.tier[0].id
}
`)

	nodes := nodesByAddress(result)
	if parent := nodes["aws_instance.web"].ParentID; parent != "aws_subnet.tier[0]" {
		t.Errorf("parent = %q, want aws_subnet.tier[0]", parent)
	}
	if parent := nodes["aws_subnet.tier[1]"].ParentID; parent != "aws_vpc.main" {
		t.Errorf("every instance should be placed, got parent %q", parent)
	}
}

func TestExpansionIsDeterministic(t *testing.T) {
	source := map[string]string{"main.tf": `
resource "aws_subnet" "tier" {
  for_each = { z = 1, a = 2, m = 3 }
  name     = each.key
}
`}

	first := addresses(Analyze(source))
	for i := 0; i < 5; i++ {
		if got := addresses(Analyze(source)); fmt.Sprint(got) != fmt.Sprint(first) {
			t.Fatalf("instance order varies between runs: %v vs %v", got, first)
		}
	}
}
