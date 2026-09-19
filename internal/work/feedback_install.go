package work

import (
	"context"
	"fmt"
	"strings"

	"github.com/fadymondy/mahaam/internal/authz"
)

/*
Install guides for the Feedback SDK: the same text for the settings page (REST)
and for an agent (MCP get_feedback_install), so "connect this project" is one
copy-paste for a human and one tool call for an AI. The packages live in sdk/
(laravel, node, go, python); the browser widget is /embed/v1.js served by the API.
The base URL is WEB_URL (the public host that proxies /embed and /api).
*/

// FeedbackStacks are the install targets, in the order the UI shows them.
var FeedbackStacks = []string{"agent", "html", "laravel", "node", "next", "go", "python"}

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
	env := fmt.Sprintf("MAHAAM_URL=%s\nMAHAAM_FEEDBACK_KEY=%s\nMAHAAM_APP_URL=https://your-app.example.com   # an allowed origin, used by server-side reports", base, key)
	tag := fmt.Sprintf(`<script src="%s/embed/v1.js" data-key="%s" defer></script>`, base, key)
	originNote := "Allowed origins: " + strings.Join(origins, ", ")
	if len(origins) == 0 {
		originNote = "No allowed origins yet: add the site's origin (https://example.com) on the key, or every report is refused."
	}
	g := map[string]string{
		"html":    fmt.Sprintf("Paste before </body> on every page:\n\n%s\n\nOptional: data-locale=\"ar\", data-theme=\"light|dark\", data-position=\"start\", data-launcher=\"false\" (then call window.MahaamFeedback.open()).\n\n%s", tag, originNote),
		"laravel": fmt.Sprintf("composer require mahaam/feedback\n\n# .env\n%s\n\n{{-- resources/views/layouts/app.blade.php, before </body> --}}\n@mahaamFeedback\n\n// report a backend exception (bootstrap/app.php → withExceptions)\n$exceptions->report(fn (Throwable $e) => MahaamFeedback::reportException($e));", env),
		"node":    fmt.Sprintf("npm i @mahaam/feedback\n\n# .env\n%s\n\n// Express\nimport { expressMiddleware, installExceptionHook } from \"@mahaam/feedback\"\napp.use(expressMiddleware())   // injects the widget into HTML responses\ninstallExceptionHook()          // files uncaught errors as issues", env),
		"next":    fmt.Sprintf("npm i @mahaam/feedback\n\n# .env\n%s\nNEXT_PUBLIC_MAHAAM_FEEDBACK_KEY=%s\n\n// app/layout.tsx, inside <body>\nimport { MahaamFeedback } from \"@mahaam/feedback/react\"\n<MahaamFeedback publicKey={process.env.NEXT_PUBLIC_MAHAAM_FEEDBACK_KEY!} baseUrl=\"%s\" />", env, key, base),
		"go":      fmt.Sprintf("go get github.com/fadymondy/mahaam/sdk/go\n\n# env\n%s\n\nimport feedback \"github.com/fadymondy/mahaam/sdk/go\"\n\nfb := feedback.New(feedback.Config{})           // reads the env vars above\nhandler = fb.Recover(fb.Middleware(handler))   // widget in HTML + panics filed as issues\n// or pass fb.ScriptTag() to an html/template and render it before </body>", env),
		"python":  fmt.Sprintf("pip install mahaam-feedback\n\n# env\n%s\n\n# Django: settings.MIDDLEWARE += [\"mahaam_feedback.django.FeedbackMiddleware\"]\n#         templates: {%% load mahaam_feedback %%}{%% mahaam_feedback %%}\n# Flask:  from mahaam_feedback.flask import init_app; init_app(app)  → {{ mahaam_feedback() }}", env),
	}
	g["agent"] = fmt.Sprintf(`Install the Mahaam Feedback SDK in this project.

1. Detect the stack (Laravel, Node/Express, Next.js, Go, Python/Django/Flask, or plain HTML).
2. Add these environment variables (never commit real .env files):
%s
3. Follow the matching guide below: install the package, render the widget on every HTML page, and hook backend exceptions so they are filed as issues.
4. Verify: open a page, click the floating "Report a problem" button, send a test report, and confirm the response carries an issue key (MG-n). Then report that key.
%s

---- Laravel ----
%s

---- Node / Express ----
%s

---- Next.js ----
%s

---- Go ----
%s

---- Python ----
%s

---- Plain HTML ----
%s`, indent(env), originNote, g["laravel"], g["node"], g["next"], g["go"], g["python"], g["html"])
	return g
}

func indent(s string) string {
	return "   " + strings.ReplaceAll(s, "\n", "\n   ")
}
