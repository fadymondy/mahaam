package account

// Keeping and revoking Sign in with Apple refresh tokens (App Store guideline 5.1.1(v): deleting
// an account must revoke its Sign in with Apple tokens). See apple_client.go for the endpoints.

import (
	"context"
	"time"

	"github.com/fadymondy/mahaam/internal/secretbox"
)

// appleClient is the configured client, or nil. Tests and deployments set the APPLE_* key
// variables; it is read per use so a changed environment (tests) takes effect.
func (s *Service) appleClient() *AppleClient {
	c, err := NewAppleClientFromEnv()
	if err != nil {
		s.log().Error("apple key", "err", err)
		return nil
	}
	return c
}

// KeepAppleToken exchanges an authorization code and stores the refresh token on the identity
// (provider apple, subject). Best effort: a failure is logged and sign-in goes on.
func (s *Service) KeepAppleToken(ctx context.Context, subject, clientID, code, redirectURI string) {
	if code == "" {
		return
	}
	c := s.appleClient()
	if c == nil {
		return
	}
	toks, err := c.Exchange(ctx, clientID, code, redirectURI)
	if err != nil {
		s.log().Warn("apple code exchange", "err", err)
		return
	}
	s.storeAppleToken(ctx, subject, clientID, toks)
}

func (s *Service) storeAppleToken(ctx context.Context, subject, clientID string, toks *AppleTokens) {
	if toks == nil || toks.RefreshToken == "" {
		return
	}
	if got := subjectOf(toks.IDToken); got != subject {
		s.log().Warn("apple code exchange: the token is for another subject")
		return
	}
	sealed, err := secretbox.Seal([]byte(toks.RefreshToken))
	if err != nil {
		s.log().Error("apple token seal", "err", err)
		return
	}
	if _, err := s.DB.ExecContext(ctx, `
		UPDATE user_identities SET refresh_token = $3, token_client_id = $2 WHERE provider = 'apple' AND subject = $1`,
		subject, clientID, sealed); err != nil {
		s.log().Error("apple token store", "err", err)
	}
}

// RevokeApple revokes every stored Apple refresh token of userID and forgets them. Best effort:
// without the key configured, or with Apple unreachable, the tokens stay (and are deleted with the
// identity at the purge) and the failure is logged.
func (s *Service) RevokeApple(ctx context.Context, userID string) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT subject, token_client_id, refresh_token FROM user_identities
		WHERE user_id = $1 AND provider = 'apple' AND refresh_token <> ''`, userID)
	if err != nil {
		s.log().Error("apple revoke: list", "user", userID, "err", err)
		return
	}
	type tok struct{ sub, client, sealed string }
	var list []tok
	for rows.Next() {
		var t tok
		if rows.Scan(&t.sub, &t.client, &t.sealed) == nil {
			list = append(list, t)
		}
	}
	rows.Close()
	if len(list) == 0 {
		return
	}
	c := s.appleClient()
	if c == nil {
		s.log().Warn("apple revoke: APPLE_TEAM_ID / APPLE_KEY_ID / APPLE_PRIVATE_KEY not configured; the Apple grant stays", "user", userID)
		return
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	for _, t := range list {
		raw, err := secretbox.Open(t.sealed)
		if err == nil {
			err = c.Revoke(ctx, t.client, string(raw))
		}
		if err != nil {
			s.log().Warn("apple revoke", "user", userID, "err", err)
			continue
		}
		_, _ = s.DB.ExecContext(ctx, `UPDATE user_identities SET refresh_token = '', token_client_id = '' WHERE provider = 'apple' AND subject = $1`, t.sub)
	}
}
