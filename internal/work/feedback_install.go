package work

import (
	"context"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
Install guides for the Feedback widget: the same text for the settings page (REST)
and for an agent (MCP get_feedback_install), so "connect this project" is one
copy-paste for a human and one tool call for an AI.

Feedback is the FRONTEND product: a browser widget authenticated with a public
pfk_ key. The UI ships as a shadcn registry item (so it borrows the host app's own
ui/* and matches its theme) and the logic as @mahaam/feedback-core; a plain script
tag covers everything that is neither React nor Vue. Server-side error reporting is
a different product with a different key — see monitor_install.go.

The base URL is WEB_URL (the public host that proxies /embed and /api).
*/

// FeedbackStacks are the install targets, in the order the UI shows them.
var FeedbackStacks = []string{"agent", "html", "react", "next", "vue"}

// registryPath is where `npx shadcn add` fetches the component from: /r/* on this app,
// which Next rewrites to the mahaam-feedback repo's GitHub Pages build. It hangs off the
// same base as every other snippet rather than a hard-coded host — the marketing domain
// is a different backend entirely and does not serve /r.
const registryPath = "/r"

// FeedbackInstall is every stack's guide for one key.
type FeedbackInstall struct {
	BaseURL   string            `json:"base_url"`
	PublicKey string            `json:"public_key"`
	Origins   []string          `json:"allowed_origins"`
	Guides    map[string]string `json:"guides"`
}

// GetFeedbackInstall builds the guides for a project's key: keyRef (id or pfk_…)
// or, when empty, the newest active key. manager+ (feedback_keys:read).
func (sv *Service) GetFeedbackInstall(ctx context.Context, projectRef, keyRef string) (*FeedbackInstall, error) {
	s, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	if err := require(s, authz.FeedbackKeysRead); err != nil {
		return nil, err
	}
	p, err := sv.FindProject(ctx, projectRef) // id or exact name
	if err != nil {
		return nil, err
	}
	keys, err := sv.ListFeedbackKeys(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	keyRef = strings.TrimSpace(keyRef)
	var k *FeedbackKey
	for i := range keys {
		c := &keys[i]
		if keyRef == "" && c.Active || keyRef != "" && (c.ID == keyRef || c.PublicKey == keyRef) {
			k = c
			break
		}
	}
	if k == nil {
		if keyRef == "" {
			return nil, invalid("this project has no active feedback key — create one first")
		}
		return nil, notFound("feedback key")
	}
	base := appURL()
	return &FeedbackInstall{BaseURL: base, PublicKey: k.PublicKey, Origins: k.AllowedOrigins, Guides: feedbackGuides(base, k.PublicKey, k.AllowedOrigins)}, nil
}

func feedbackGuides(base, key string, origins []string) map[string]string {
	endpoint := base + "/api/feedback/embed"
	tag := fmt.Sprintf(`<script src="%s/embed/v1.js" data-key="%s" defer></script>`, base, key)

	originNote := "Allowed origins: " + strings.Join(origins, ", ")
	if len(origins) == 0 {
		originNote = "No allowed origins yet: add the site's origin (https://example.com) on the key, or every report is refused."
	}

	g := map[string]string{
		"html": fmt.Sprintf(`Paste before </body> on every page:

%s

Optional: data-locale="ar", data-theme="light|dark", data-position="start",
data-launcher="false" (then call window.MahaamFeedback.open()).

%s`, tag, originNote),

		"react": fmt.Sprintf(`# The UI installs into your project, so it uses your own ui/* and matches your theme.
npx shadcn@latest add %s/feedback.json
npm i @mahaam/feedback-core

// Peers pulled from your shadcn kit: button, dialog, field, input, select, textarea.

// .env
NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY=%s

// Render it once, anywhere in your app:
import { FeedbackLauncher } from "@/components/mahaam/feedback-launcher"

<FeedbackLauncher
  target="%s"
  submitOptions={{ headers: { "X-Mahaam-Key": process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY! } }}
  locale="en"
/>

%s`, base+registryPath, key, endpoint, originNote),

		"next": fmt.Sprintf(`npx shadcn@latest add %s/feedback.json
npm i @mahaam/feedback-core

# .env
NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY=%s

// app/layout.tsx — FeedbackLauncher is a client component ("use client" is already
// in the file the CLI copied in), so render it inside <body>.
import { FeedbackLauncher } from "@/components/mahaam/feedback-launcher"

<FeedbackLauncher
  target="%s"
  submitOptions={{ headers: { "X-Mahaam-Key": process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY! } }}
/>

%s`, base+registryPath, key, endpoint, originNote),

		"vue": fmt.Sprintf(`npx shadcn-vue@latest add %s/feedback-vue.json
npm i @mahaam/feedback-core

// Peers pulled from your shadcn-vue kit: button, dialog, input, label, select, textarea.

<script setup lang="ts">
import { FeedbackLauncher } from "@/components/mahaam"
</script>

<template>
  <FeedbackLauncher
    target="%s"
    :submit-options="{ headers: { 'X-Mahaam-Key': '%s' } }"
  />
</template>

%s`, base+registryPath, endpoint, key, originNote),
	}

	g["agent"] = fmt.Sprintf(`Add the Mahaam Feedback widget to this project.

Feedback is a frontend-only product: a browser widget that reports to Mahaam with a
public key. Do NOT look for a server-side feedback package — backend error reporting
is a separate product (the Mahaam SDK, DSN-based).

1. Detect the stack: Next.js, React, Vue, or anything else (static HTML, Rails, PHP…).
2. Public key (public-safe, but still put it in env rather than in code): %s
   Intake endpoint: %s
   %s
3. Follow the matching guide below.
4. Verify: load a page, open the reporter, send a test report, and confirm the
   response carries an issue key (MG-n). Then delete the test issue.

---- React (shadcn) ----
%s

---- Next.js ----
%s

---- Vue (shadcn-vue) ----
%s

---- Anything else: plain script tag ----
%s`, key, endpoint, originNote, g["react"], g["next"], g["vue"], g["html"])

	return g
}

func indent(s string) string {
	return "   " + strings.ReplaceAll(s, "\n", "\n   ")
}
