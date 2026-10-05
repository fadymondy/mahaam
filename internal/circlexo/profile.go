package circlexo

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"time"

	circlexo "github.com/circlexo/circlexo-go"

	"github.com/fadymondy/mahaam/internal/account"
	"github.com/fadymondy/mahaam/internal/platform"
)

/*
Profile sync (MH-1149). The hub owns who a person is: their name, e-mail address, picture,
language and timezone. Mahaam overwrites its copy for a linked user on every CircleXO sign-in
(from the ID token) and whenever the hub sends user.updated, so a change made on circlexo.com
shows in Mahaam without anyone editing it twice.

The picture is downloaded and re-encoded to Mahaam's inline avatar (account.AvatarDataURL) only
when the hub's URL changed (circlexo_user_links.picture_url), never on every sign-in. A new
address is taken only when the hub says it is verified and no other Mahaam account holds it.
*/

// avatarClient fetches hub pictures: short, and no redirects off https.
var avatarClient = &http.Client{
	Timeout: 10 * time.Second,
	CheckRedirect: func(r *http.Request, via []*http.Request) error {
		if r.URL.Scheme != "https" || len(via) > 3 {
			return http.ErrUseLastResponse
		}
		return nil
	},
}

// SyncProfile overwrites userID's Mahaam profile with the hub's. Failures are logged: a sign-in
// never fails because a picture could not be fetched.
func (s *Service) SyncProfile(ctx context.Context, userID string, p circlexo.Profile, timezone string) {
	s.syncFields(ctx, userID, p, timezone)
	s.syncPicture(ctx, userID, p.Picture)
}

// syncProfileAtSignIn is SyncProfile with the picture fetched after the sign-in returns, so a
// slow image host never holds it up.
func (s *Service) syncProfileAtSignIn(ctx context.Context, userID string, p circlexo.Profile, timezone string) {
	s.syncFields(ctx, userID, p, timezone)
	go func() {
		ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 20*time.Second)
		defer cancel()
		s.syncPicture(ctx, userID, p.Picture)
	}()
}

func (s *Service) syncFields(ctx context.Context, userID string, p circlexo.Profile, timezone string) {
	name := strings.TrimSpace(p.Name)
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}
	var locale any
	switch l := strings.ToLower(p.Locale); {
	case strings.HasPrefix(l, "ar"):
		locale = "ar"
	case strings.HasPrefix(l, "en"):
		locale = "en"
	}
	var tz any
	if timezone != "" {
		if _, err := time.LoadLocation(timezone); err == nil && timezone != "Local" && len(timezone) <= 64 {
			tz = timezone
		}
	}
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO user_profiles (user_id, name, locale, timezone) VALUES ($1, $2, $3, $4)
		ON CONFLICT (user_id) DO UPDATE SET
			name     = CASE WHEN $2 <> '' THEN $2 ELSE user_profiles.name END,
			locale   = coalesce($3, user_profiles.locale),
			timezone = coalesce($4, user_profiles.timezone),
			updated_at = now()`, userID, name, locale, tz); err != nil {
		s.Log.Warn("circlexo: syncing the profile", "user", userID, "err", err)
	}
	if email := norm(p.Email); email != "" && p.EmailVerified {
		s.syncEmail(ctx, userID, email)
	}
}

// syncEmail moves the account to the hub's address unless another account holds it.
func (s *Service) syncEmail(ctx context.Context, userID, email string) {
	var cur string
	if err := s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&cur); err != nil || strings.EqualFold(cur, email) {
		return
	}
	var other string
	err := s.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = $1 AND id <> $2`, email, userID).Scan(&other)
	if err == nil {
		s.Log.Warn("circlexo: the hub's address belongs to another Mahaam account; keeping the old one", "user", userID)
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return
	}
	if _, err := s.DB.ExecContext(ctx, `UPDATE users SET email = $2 WHERE id = $1`, userID, email); err != nil {
		s.Log.Warn("circlexo: syncing the address", "user", userID, "err", err)
		return
	}
	_, _ = s.DB.ExecContext(ctx, `UPDATE circlexo_user_links SET email = $2 WHERE user_id = $1`, userID, email)
	_, _ = s.DB.ExecContext(ctx, `
		INSERT INTO platform_users (user_id, email_verified_at, updated_at) VALUES ($1, now(), now())
		ON CONFLICT (user_id) DO UPDATE SET email_verified_at = now(), updated_at = now()`, userID)
	platform.Invalidate(userID)
}

// syncPicture refreshes the avatar when the hub's picture URL changed ("" clears one the hub set).
func (s *Service) syncPicture(ctx context.Context, userID, picture string) {
	var had sql.NullString
	if err := s.DB.QueryRowContext(ctx, `SELECT picture_url FROM circlexo_user_links WHERE user_id = $1`, userID).Scan(&had); err != nil {
		return
	}
	if had.String == picture {
		return
	}
	data := ""
	if picture != "" {
		if !strings.HasPrefix(picture, "https://") {
			return
		}
		var err error
		if data, err = fetchAvatar(ctx, picture); err != nil {
			s.Log.Warn("circlexo: fetching the hub picture", "user", userID, "err", err)
			return
		}
	} else if !had.Valid || had.String == "" {
		return
	}
	if err := account.SetAvatar(ctx, s.DB, userID, data); err != nil {
		s.Log.Warn("circlexo: storing the hub picture", "user", userID, "err", err)
		return
	}
	_, _ = s.DB.ExecContext(ctx, `UPDATE circlexo_user_links SET picture_url = $2 WHERE user_id = $1`, userID, picture)
}

func fetchAvatar(ctx context.Context, u string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return "", err
	}
	res, err := avatarClient.Do(req)
	if err != nil {
		return "", err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return "", errors.New("circlexo: picture answered " + res.Status)
	}
	return account.AvatarDataURL(res.Body)
}
