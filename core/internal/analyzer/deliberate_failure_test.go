package analyzer

import "testing"

// Temporary: proves CI fails on a broken Go test. Removed immediately after.
func TestDeliberateFailure(t *testing.T) {
	t.Fatal("deliberate failure to verify CI catches broken Go tests")
}
