package account

// Who a provider's stable subject is here (user_identities). Apple, Google and GitHub all sign a
// person in by a subject that never changes (Apple's `sub`, Google's `sub`, GitHub's numeric user
// id), while the email they report can: a private relay address, a renamed Google account, a new
// primary address on GitHub. So the link is kept by (provider, subject), and the email is only
// what joins a subject to an account the FIRST time it is seen:
//
//   - a subject already linked signs in to its account, whatever the email says now;
//   - an unseen subject whose VERIFIED email matches an account is linked to it. An unverified
//     address never links: anyone can type a victim's address into a provider account;
//   - an unseen subject with no matching account gets a new passwordless account (password_hash
//     "!sso", like the auth plugin's OAuth accounts), its email marked verified when the provider
//     verified it, and the name the provider shares.
//
// CircleXO keeps its own links (circlexo_user_links); an account can have both.

import (
	"context"
	"database/sql"
	"errors"
	"time"

	"github.com/togo-framework/auth"
)

var (
	ErrSocialNoEmail    = errors.New("the provider did not share an email address; allow it when you sign in, or sign in another way")
	ErrSocialEmailTaken = errors.New("an account with this email already exists; sign in to it another way")
	ErrSocialUnverified = errors.New("the provider has not verified this email address")
)

// SocialProviders are the providers user_identities knows.
var SocialProviders = []string{"apple", "google", "github"}

// SocialIdentity is a provider's verified statement about who signed in.
type SocialIdentity struct {
	Provider      string
	Subject       string
	Email         string
	EmailVerified bool
	Name          string
}

// SocialAccount finds the account for a provider identity, linking or creating one the first time
// the subject is seen. created reports a new account.
func (s *Service) SocialAccount(ctx context.Context, id SocialIdentity, locale string) (userID string, created bool, err error) {
	if id.Subject == "" || len(id.Subject) > 255 {
		return "", false, errors.New("no subject")
	}
	name := cleanName(id.Name)
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return "", false, err
	}
	defer func() { _ = tx.Rollback() }()
	// One first sign-in per subject at a time: two racing must not make two accounts.
	if _, err := tx.ExecContext(ctx, `SELECT pg_advisory_xact_lock(hashtext($1 || ':' || $2::text))`, id.Provider, id.Subject); err != nil {
		return "", false, err
	}
	err = tx.QueryRowContext(ctx, `SELECT user_id FROM user_identities WHERE provider = $1 AND subject = $2`, id.Provider, id.Subject).Scan(&userID)
	switch {
	case err == nil:
		if _, err := tx.ExecContext(ctx, `
			UPDATE user_identities SET last_used_at = now(), email = CASE WHEN $3 = '' THEN email ELSE $3 END
			WHERE provider = $1 AND subject = $2`, id.Provider, id.Subject, id.Email); err != nil {
			return "", false, err
		}
	case errors.Is(err, sql.ErrNoRows):
		if id.Email == "" {
			return "", false, ErrSocialNoEmail
		}
		err = tx.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = lower($1)`, id.Email).Scan(&userID)
		switch {
		case err == nil:
			// Linking to an existing account is only safe on an address the provider verified.
			if !id.EmailVerified {
				return "", false, ErrSocialEmailTaken
			}
		case errors.Is(err, sql.ErrNoRows):
			userID, created = randHex(16), true
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO users (id, email, password_hash, roles, permissions, created_at) VALUES ($1, $2, '!sso', '', '', $3)`,
				userID, id.Email, time.Now().UTC().Format(time.RFC3339)); err != nil {
				return "", false, err
			}
			var loc any
			if locale == "en" || locale == "ar" {
				loc = locale
			}
			if _, err := tx.ExecContext(ctx, `INSERT INTO user_profiles (user_id, name, locale) VALUES ($1, $2, $3)`, userID, name, loc); err != nil {
				return "", false, err
			}
		default:
			return "", false, err
		}
		if id.EmailVerified {
			if err := markVerified(ctx, tx, userID); err != nil {
				return "", false, err
			}
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_identities (provider, subject, user_id, email) VALUES ($1, $2, $3, $4)`,
			id.Provider, id.Subject, userID, id.Email); err != nil {
			return "", false, err
		}
	default:
		return "", false, err
	}
	// A provider's name fills an empty profile name and never replaces one the person chose.
	if !created && name != "" {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO user_profiles (user_id, name) VALUES ($1, $2)
			ON CONFLICT (user_id) DO UPDATE SET name = EXCLUDED.name, updated_at = now() WHERE user_profiles.name = ''`,
			userID, name); err != nil {
			return "", false, err
		}
	}
	return userID, created, tx.Commit()
}

// IdentityOf is the auth identity a session for userID carries.
func (s *Service) IdentityOf(ctx context.Context, userID string) (*auth.Identity, error) {
	return s.identity(ctx, userID)
}
