package mcp

import (
	"slices"
	"strings"
	"testing"

	circlexo "github.com/circlexo/circlexo-go"
)

func TestHubToolScopes(t *testing.T) {
	// Hub gateway scopes say nothing about tools: a plain token gets reads only.
	plain := hubToolScopes(&circlexo.Claims{Scope: "openid org"})
	if len(plain) == 0 {
		t.Fatal("expected the read scopes")
	}
	for _, s := range plain {
		if !strings.HasSuffix(s, ":read") {
			t.Errorf("a plain hub token got %s", s)
		}
	}
	// Named tool scopes are taken as they are.
	named := hubToolScopes(&circlexo.Claims{Scope: "openid tasks:write"})
	if !slices.Equal(named, []string{"tasks:write"}) {
		t.Errorf("named scopes: %v", named)
	}
	// Every scope the agent set names is a real Mahaam scope.
	for _, s := range hubAgentScopes {
		if _, ok := userScope(s); !ok {
			t.Errorf("hubAgentScopes has %q, which is not a user scope", s)
		}
	}
}
