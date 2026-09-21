package work

import (
	"strings"
	"testing"
)

/*
Guards on the install guides. These are the first thing anyone sees of an SDK, and the
failure mode is quiet: a stack listed in the UI with no guide behind it renders an empty
tab, and a guide that has lost its DSN placeholder tells people to install a client that
will silently disable itself.

The UI's own list lives in web/components/work/feedback-widget.tsx and is checked against
these by hand — a Go test cannot reach it.
*/

const testDSN = "https://mdsn_0123456789abcdef@mcp.mahaam.app/monitor/proj-1"

func TestMonitorGuidesCoverEveryListedStack(t *testing.T) {
	g := monitorGuides(testDSN)
	for _, s := range MonitorStacks {
		if strings.TrimSpace(g[s]) == "" {
			t.Errorf("stack %q is offered in the UI but has no guide, so its tab renders empty", s)
		}
	}
	if len(g) != len(MonitorStacks) {
		t.Errorf("guides = %d, MonitorStacks = %d: a guide nobody can reach is dead text", len(g), len(MonitorStacks))
	}
}

func TestEveryMonitorGuideCarriesTheDSN(t *testing.T) {
	g := monitorGuides(testDSN)
	for _, s := range MonitorStacks {
		if !strings.Contains(g[s], testDSN) {
			// Without it the reader installs a client that disables itself and reports nothing.
			t.Errorf("the %q guide never shows the DSN", s)
		}
	}
}

func TestTheAgentGuideIncludesEveryOtherGuide(t *testing.T) {
	// The agent guide is one prompt pasted into a coding agent, so a stack missing from it
	// is a stack the agent cannot install.
	g := monitorGuides(testDSN)
	for _, s := range MonitorStacks {
		if s == "agent" {
			continue
		}
		if !strings.Contains(g["agent"], g[s]) {
			t.Errorf("the agent prompt does not include the %q guide", s)
		}
	}
}

func TestMobileGuidesSayWhatTheyDoNotCover(t *testing.T) {
	// A reporter that implies it catches native crashes is worse than none: people stop
	// looking for the crash reporter that would actually have caught them.
	g := monitorGuides(testDSN)
	for _, s := range []string{"react-native", "flutter", "kotlin", "swift"} {
		if !strings.Contains(g[s], "Crashlytics") {
			t.Errorf("the %q guide does not say native crashes go to Crashlytics", s)
		}
	}
	if !strings.Contains(g["agent"], "Crashlytics") {
		t.Error("the agent prompt does not warn about native crashes, so an agent will promise coverage we lack")
	}
}

func TestMobileGuidesTellPeopleToPersist(t *testing.T) {
	// A phone is offline far more often than a server. Without a store, a failed send is
	// simply lost, and the crash case loses the report that mattered most.
	g := monitorGuides(testDSN)
	for _, s := range []string{"react-native", "flutter", "kotlin", "swift"} {
		lower := strings.ToLower(g[s])
		if !strings.Contains(lower, "store") && !strings.Contains(lower, "storage") {
			t.Errorf("the %q guide never mentions durable storage", s)
		}
	}
}

func TestFeedbackGuidesCoverEveryListedStack(t *testing.T) {
	g := feedbackGuides("https://console.mahaam.app", "pfk_0123456789abcdef", []string{"https://example.test"})
	for _, s := range FeedbackStacks {
		if strings.TrimSpace(g[s]) == "" {
			t.Errorf("stack %q is offered in the UI but has no guide", s)
		}
	}
}

func TestTheTwoProductsAreNotConfusedForEachOther(t *testing.T) {
	// A project holds one key of each kind and they are not interchangeable. Pasting a
	// monitoring DSN into the widget, or the reverse, fails with a 403 that says nothing
	// useful, so the guides must not hand anyone the wrong key.
	m := monitorGuides(testDSN)
	f := feedbackGuides("https://console.mahaam.app", "pfk_0123456789abcdef", []string{"https://example.test"})
	for _, s := range MonitorStacks {
		if strings.Contains(m[s], "pfk_") {
			t.Errorf("the monitoring guide for %q mentions a feedback key", s)
		}
	}
	for _, s := range FeedbackStacks {
		if strings.Contains(f[s], "mdsn_") {
			t.Errorf("the feedback guide for %q mentions a monitoring DSN", s)
		}
	}
}
