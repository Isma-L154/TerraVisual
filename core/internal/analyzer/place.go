package analyzer

import (
	"fmt"
	"sort"
	"strings"

	"github.com/Isma-L154/TerraVisual/core/internal/catalog"
	"github.com/Isma-L154/TerraVisual/core/internal/model"
)

// Synthetic containers are not Terraform resources. They exist because a
// diagram of nothing but resources has no frame: a learner needs to see that
// these things live in a cloud, and in a region of it.
//
// They are addressed with a prefix no Terraform resource type can produce,
// since a resource type may not contain a dot.
const (
	providerNodePrefix = "provider."
	regionNodePrefix   = "region."
)

// placement is everything the containment pass needs that evaluation produced.
type placement struct {
	// references maps a resource address to the resources each of its
	// attributes points at. Containment is decided from these, because it is a
	// property of the reference, not of the evaluated value — most references
	// point at attributes Terraform only computes on apply.
	references map[string]map[string][]string

	// regions maps a provider to its configured region, when exactly one
	// provider block declares it. With aliases or an unresolvable value there
	// is no single answer, and inventing one would misplace every resource.
	regions map[string]string
}

// applyCatalog turns evaluated resources into placed, categorised nodes.
//
// Terraform has no concept of containment (ADR-0004), so every parent here is
// a decision recorded in the catalog rather than a fact read from the code.
func applyCatalog(nodes []model.Node, p placement, diags *diagnostics) []model.Node {
	cat, err := catalog.Load()
	if err != nil {
		diags.add(model.Diagnostic{
			Severity: "error",
			Code:     "catalog-unavailable",
			Message:  fmt.Sprintf("The resource catalog could not be loaded, so nothing could be placed: %v", err),
		})
		return nodes
	}

	existing := make(map[string]bool, len(nodes))
	// A reference names a resource, not an instance: `subnet_id =
	// aws_subnet.public[0].id` and `aws_subnet.public.id` both point at the
	// same block. Containment has to pick one instance, so it picks the first
	// in address order -- stable, and the only defensible choice when a
	// resource can be drawn in exactly one place.
	firstInstance := map[string]string{}
	for _, node := range nodes {
		existing[node.Address] = true
		base, suffix := splitInstanceAddress(node.Address)
		if suffix == "" {
			continue
		}
		if current, seen := firstInstance[base]; !seen || node.Address < current {
			firstInstance[base] = node.Address
		}
	}

	// First pass: presentation and containment from the catalog.
	for i := range nodes {
		node := &nodes[i]

		entry, known := cat.Lookup(node.Type)
		node.Catalogued = known
		if known {
			node.Category = entry.Category
			node.IsContainer = entry.IsContainer
			if entry.Provider != "" {
				node.Provider = entry.Provider
			}
		}

		node.ParentID = resolveParent(*node, entry, known, p.references, existing, firstInstance)
	}

	// Second pass: the frame. Only providers that actually appear get a
	// container, so an AWS-only workspace does not sprout empty Azure boxes.
	nodes = addSyntheticContainers(nodes, p.regions)

	// Third pass: anything still parentless is genuinely unplaced, and says so
	// rather than being quietly dropped into whatever box is nearest.
	//
	// Synthetic containers are excluded: the outermost frame has no parent by
	// construction, and calling that "unplaced" would tell the interface to
	// draw the whole diagram in the tray for things we could not place.
	for i := range nodes {
		if isSynthetic(nodes[i].ID) {
			nodes[i].Unplaced = false
			continue
		}
		nodes[i].Unplaced = nodes[i].ParentID == ""
	}

	guardAgainstCycles(nodes, diags)
	return nodes
}

// resolveParent walks the catalog's rules in priority order and takes the first
// that points at a resource this workspace actually declares.
//
// Priority is what makes an EC2 instance land in its subnet rather than in the
// VPC: both are true, and the more specific one is the more useful.
func resolveParent(
	node model.Node,
	entry catalog.Entry,
	known bool,
	references map[string]map[string][]string,
	existing map[string]bool,
	firstInstance map[string]string,
) string {
	if !known {
		return ""
	}

	byAttribute := references[node.Address]
	for _, rule := range entry.ParentRules {
		targets := byAttribute[rule.Attribute]
		if len(targets) == 0 {
			continue
		}

		// A list attribute such as an ALB's `subnets` names several possible
		// parents. Taking the first in sorted order is an editorial choice, and
		// a deliberate one: a resource can only be drawn in one place, and a
		// stable choice beats an arbitrary one.
		sorted := append([]string(nil), targets...)
		sort.Strings(sorted)

		for _, target := range sorted {
			if target == node.Address {
				continue
			}
			if existing[target] {
				return target
			}
			if instance, expanded := firstInstance[target]; expanded && instance != node.Address {
				return instance
			}
		}
	}
	return ""
}

// addSyntheticContainers wraps the workspace in provider and region boxes.
func addSyntheticContainers(nodes []model.Node, regions map[string]string) []model.Node {
	providers := map[string]bool{}
	for _, node := range nodes {
		if node.ParentID == "" && node.Provider != "" && node.Provider != "unknown" {
			providers[node.Provider] = true
		}
	}
	if len(providers) == 0 {
		return nodes
	}

	names := make([]string, 0, len(providers))
	for provider := range providers {
		names = append(names, provider)
	}
	sort.Strings(names)

	containers := make([]model.Node, 0, len(names)*2)
	parentFor := map[string]string{}

	for _, provider := range names {
		providerID := providerNodePrefix + provider
		containers = append(containers, syntheticNode(providerID, "provider", provider, providerLabel(provider), ""))
		parentFor[provider] = providerID

		if region, ok := regions[provider]; ok && region != "" {
			regionID := regionNodePrefix + provider + "." + region
			containers = append(containers, syntheticNode(regionID, "region", provider, region, providerID))
			parentFor[provider] = regionID
		}
	}

	for i := range nodes {
		if nodes[i].ParentID == "" {
			if parent, ok := parentFor[nodes[i].Provider]; ok {
				nodes[i].ParentID = parent
			}
		}
	}

	// Containers first so consumers can build the tree in one pass without
	// having to look ahead for a parent they have not seen yet.
	return append(containers, nodes...)
}

// isSynthetic reports whether a node is part of the frame rather than
// something the user wrote.
func isSynthetic(id string) bool {
	return strings.HasPrefix(id, providerNodePrefix) || strings.HasPrefix(id, regionNodePrefix)
}

func syntheticNode(id, nodeType, provider, label, parentID string) model.Node {
	return model.Node{
		ID:          id,
		Address:     id,
		Type:        nodeType,
		Provider:    provider,
		Category:    nodeType,
		Label:       label,
		IsContainer: true,
		ParentID:    parentID,
		Catalogued:  true,
		Attributes:  map[string]model.Attribute{},
	}
}

func providerLabel(provider string) string {
	switch provider {
	case "aws":
		return "AWS"
	case "azure":
		return "Azure"
	case "gcp":
		return "Google Cloud"
	default:
		return provider
	}
}

// guardAgainstCycles breaks containment loops rather than handing them to a
// renderer that would recurse forever.
//
// A cycle needs mutually referencing resources and catalog rules pointing both
// ways, so it should be impossible — which is exactly why it is worth checking:
// the cost of being wrong is an unrecoverable hang in the user's tab.
func guardAgainstCycles(nodes []model.Node, diags *diagnostics) {
	parentOf := make(map[string]string, len(nodes))
	for _, node := range nodes {
		parentOf[node.ID] = node.ParentID
	}

	for i := range nodes {
		seen := map[string]bool{nodes[i].ID: true}
		current := nodes[i].ParentID

		for depth := 0; current != "" && depth < len(nodes)+1; depth++ {
			if seen[current] {
				diags.add(model.Diagnostic{
					Severity: "warning",
					Code:     "containment-cycle",
					Message: fmt.Sprintf(
						"%s and its parents form a containment loop, so it is shown unplaced.",
						nodes[i].Address),
					Source: nodes[i].Source,
				})
				nodes[i].ParentID = ""
				break
			}
			seen[current] = true
			current = parentOf[current]
		}
	}
}
