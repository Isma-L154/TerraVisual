package analyzer

import (
	"testing"

	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

func edgeBetween(result model.Result, from, to string) (model.Edge, bool) {
	for _, edge := range result.Edges {
		if edge.From == from && edge.To == to {
			return edge, true
		}
	}
	return model.Edge{}, false
}

// The model carries every reference; the catalog decides which few reach the
// picture. Drawing them all produces the tangle this product exists to avoid.
func TestOnlyCuratedRelationshipsAreDrawn(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "main" {}

resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.main.id
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }
}

resource "aws_security_group" "web" {
  vpc_id = aws_vpc.main.id
}

resource "aws_subnet" "public" {
  vpc_id = aws_vpc.main.id
}

resource "aws_instance" "web" {
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
}
`)

	t.Run("a route to the internet is drawn", func(t *testing.T) {
		edge, found := edgeBetween(result, "aws_route_table.public", "aws_internet_gateway.igw")
		if !found {
			t.Fatal("the route to the internet gateway is missing entirely")
		}
		if !edge.Drawn {
			t.Error("a route to the internet is exactly the kind of thing a diagram should show")
		}
		if edge.Kind != "traffic" {
			t.Errorf("kind = %q, want traffic", edge.Kind)
		}
		// The catalog's label answers the question somebody actually has
		// about an arrow. The attribute path answers a different, less
		// useful one.
		if edge.Label != "to internet" {
			t.Errorf("label = %q, want the catalog's wording", edge.Label)
		}
	})

	t.Run("security group wiring is recorded but not drawn", func(t *testing.T) {
		edge, found := edgeBetween(result, "aws_instance.web", "aws_security_group.web")
		if !found {
			t.Fatal("the relationship should still exist in the model")
		}
		if edge.Drawn {
			t.Error("every instance wired to every group is the tangle this product avoids")
		}
		if edge.Kind != "security" {
			t.Errorf("kind = %q, want security", edge.Kind)
		}
	})

	// An arrow to the box you are already inside says nothing.
	t.Run("the reference that placed a resource is not also drawn", func(t *testing.T) {
		edge, found := edgeBetween(result, "aws_subnet.public", "aws_vpc.main")
		if !found {
			t.Fatal("the reference should still be recorded")
		}
		if edge.Drawn {
			t.Error("the subnet is already inside the VPC; an arrow adds nothing")
		}
	})
}

// A relationship with no rule stays recorded and undrawn. Silence is the right
// default: a connection nobody decided was worth showing probably is not.
func TestUncuratedReferencesDefaultToUndrawn(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_s3_bucket" "assets" {}

resource "aws_lambda_function" "handler" {
  some_unruled_attribute = aws_s3_bucket.assets.id
}
`)

	edge, found := edgeBetween(result, "aws_lambda_function.handler", "aws_s3_bucket.assets")
	if !found {
		t.Fatal("the reference should be recorded even without a rule")
	}
	if edge.Drawn {
		t.Error("a relationship nobody curated should not appear in the diagram")
	}
	if edge.Kind != "reference" {
		t.Errorf("kind = %q, want the neutral reference kind", edge.Kind)
	}
}

func TestDrawnEdgesAcrossProviders(t *testing.T) {
	result := analyzeSource(t, `
resource "google_compute_forwarding_rule" "front" {
  name            = "front"
  backend_service = google_compute_region_backend_service.api.id
}

resource "google_compute_region_backend_service" "api" {
  name = "api"
}
`)

	edge, found := edgeBetween(result, "google_compute_forwarding_rule.front", "google_compute_region_backend_service.api")
	if !found {
		t.Fatal("the reference is missing")
	}
	if !edge.Drawn || edge.Kind != "traffic" {
		t.Errorf("edge = %+v, want a drawn traffic edge", edge)
	}
}

// Edges carry positions like everything else, so a connection can be clicked
// through to the line that creates it.
func TestEdgesCarryTheirSource(t *testing.T) {
	result := analyzeSource(t, `
resource "aws_vpc" "main" {}
resource "aws_subnet" "public" { vpc_id = aws_vpc.main.id }
`)

	edge, _ := edgeBetween(result, "aws_subnet.public", "aws_vpc.main")
	if edge.Source.File != "main.tf" || edge.Source.StartLine < 1 {
		t.Errorf("source = %+v, want a real position", edge.Source)
	}
}
