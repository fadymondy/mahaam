package account

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/mail"
	"golang.org/x/crypto/bcrypt"

	"github.com/fadymondy/mahaam/internal/platform"
)

/*
Deleting an account (MH-344). App Review 5.1.1(v): an app that creates accounts must let a
person delete theirs from inside the app.

	POST /api/me/delete {password}
	  409 sole_owner  with the workspaces they alone own: hand those over or delete them first
	  202             {purge_after}: signed out everywhere now, gone after the grace period

It's two steps, not one, because a deletion can't be taken back and people change their minds.
For GraceDays nothing is destroyed, and signing in again is the whole of "undo": the first request
on a new session cancels the deletion (Cancel, called from the guard). No support ticket, no
second button to find.

What happens at the end is ANONYMISE, not DELETE. Other people's work points at this user row:
time entries that are on invoices, comments in a thread, activity in a log, reports filed. Deleting
the row would either fail on those foreign keys or cascade into other people's records. So the row
stays and stops being anyone. The email becomes deleted-<id>@deleted.invalid (the original
address is free to sign up again), the password can never match, and everything that was only
theirs goes: profile, memberships, assignments, tokens, codes, their own inbox, their GitHub
mapping.

Refusing when they are a workspace's only owner is the proposal on the card and it's the
cautious default. Deleting a workspace with the account would take its members' work with it,
and orphaning it would leave a workspace nobody can administer.
*/

// GraceDays is how long a deleted account can still be recovered. ACCOUNT_DELETE_GRACE_DAYS
// overrides it (0 is allowed, for a deployment that must purge at the next reaper run).
func GraceDays() int {
	if v, err := strconv.Atoi(strings.TrimSpace(os.Getenv("ACCOUNT_DELETE_GRACE_DAYS"))); err == nil && v >= 0 {
		return v
	}
	return 14
}

// OwnedWorkspace is a workspace the person is the only owner of.
type OwnedWorkspace struct {
	ID   string `json:"id"`
	Slug string `json:"slug"`
	Name string `json:"name"`
}

// SoleOwnerError is the refusal: these workspaces would be left without an owner.
type SoleOwnerError struct{ Workspaces []OwnedWorkspace }

func (e *SoleOwnerError) Error() string {
	return "you are the only owner of " + strconv.Itoa(len(e.Workspaces)) + " workspace(s); make someone else an owner or delete them first"
}

// soleOwned lists the workspaces userID owns with no other active owner. q is a *sql.DB or *sql.Tx.
func soleOwned(ctx context.Context, q interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}, userID string) ([]OwnedWorkspace, error) {
	rows, err := q.QueryContext(ctx, `
		SELECT w.id, w.slug, w.name FROM workspaces w
		JOIN workspace_members m ON m.workspace_id = w.id
		WHERE m.user_id = $1 AND m.role = 'owner' AND m.status = 'active'
		  AND NOT EXISTS (
			SELECT 1 FROM workspace_members o
			WHERE o.workspace_id = w.id AND o.role = 'owner' AND o.status = 'active' AND o.user_id <> $1)
		ORDER BY lower(w.name)`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OwnedWorkspace{}
	for rows.Next() {
		var w OwnedWorkspace
		if err := rows.Scan(&w.ID, &w.Slug, &w.Name); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// RequestDeletion checks the password and the ownership rule, then signs the account out of
// everything at once and schedules the purge.
func (s *Service) RequestDeletion(ctx context.Context, userID, password, code, recovery, locale string) (time.Time, error) {
	var email, hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT email, password_hash FROM users WHERE id = $1`, userID).Scan(&email, &hash); err != nil {
		return time.Time{}, err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return time.Time{}, errWrongPassword
	}
	// With 2FA on, the password alone doesn't delete the account (MH-341).
	if TwoFAEnabled(ctx, s.DB, userID) {
		if code == "" && recovery == "" {
			return time.Time{}, errSecondFactorRequired
		}
		if err := s.SecondFactor(ctx, userID, code, recovery); err != nil {
			return time.Time{}, err
		}
	}
	owned, err := soleOwned(ctx, s.DB, userID)
	if err != nil {
		return time.Time{}, err
	}
	if len(owned) > 0 {
		return time.Time{}, &SoleOwnerError{Workspaces: owned}
	}

	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return time.Time{}, err
	}
	defer func() { _ = tx.Rollback() }()
	var purge time.Time
	if err := tx.QueryRowContext(ctx, `
		INSERT INTO platform_users (user_id, deletion_requested_at, purge_after, sessions_valid_after, updated_at)
		VALUES ($1, now(), now() + $2 * interval '1 day', now(), now())
		ON CONFLICT (user_id) DO UPDATE SET deletion_requested_at = now(), purge_after = EXCLUDED.purge_after,
			sessions_valid_after = now(), updated_at = now()
		RETURNING purge_after`, userID, GraceDays()).Scan(&purge); err != nil {
		return time.Time{}, err
	}
	// Everything that could act as this person stops now, not at the purge. A session is ended by
	// sessions_valid_after; the tokens are deleted outright, because signing in again cancels the
	// deletion and must not bring an agent's token back with it.
	if err := execAll(ctx, tx, userID,
		`DELETE FROM personal_access_tokens WHERE user_id = $1`,
		`DELETE FROM mcp_tokens WHERE user_id = $1`,
		`DELETE FROM admin_mcp_tokens WHERE user_id = $1`,
		`DELETE FROM oauth_refresh_tokens WHERE user_id = $1`,
		`DELETE FROM oauth_codes WHERE user_id = $1`,
		`DELETE FROM push_subscriptions WHERE user_id = $1`,
		`DELETE FROM devices WHERE user_id = $1`,
	); err != nil {
		return time.Time{}, err
	}
	if err := tx.Commit(); err != nil {
		return time.Time{}, err
	}
	platform.Invalidate(userID)
	s.mailAsync(deletionScheduledMail(email, purge, locale), "deletion scheduled", userID)
	return purge, nil
}

// Cancel reverses a pending deletion because the person signed in again. The guard calls it for
// every request whose account has one pending, which can only be a session made after the
// request: the older ones were all ended when it was made. Reports whether there was one.
func Cancel(ctx context.Context, s *Service, userID string) bool {
	var email string
	err := s.DB.QueryRowContext(ctx, `
		UPDATE platform_users p SET deletion_requested_at = NULL, purge_after = NULL, updated_at = now()
		FROM users u
		WHERE p.user_id = $1 AND u.id = p.user_id AND p.deletion_requested_at IS NOT NULL AND p.deleted_at IS NULL
		RETURNING u.email`, userID).Scan(&email)
	if err != nil {
		return false
	}
	platform.Invalidate(userID)
	s.mailAsync(deletionCancelledMail(email, ""), "deletion cancelled", userID)
	return true
}

// PurgeDue anonymises every account whose grace period is over. Idempotent; run by the scheduler.
// An account that has become a workspace's only owner during its grace period (the other owner
// left) is skipped and logged rather than purged: the same rule as the request, checked again.
func (s *Service) PurgeDue(ctx context.Context, now time.Time) (int, error) {
	rows, err := s.DB.QueryContext(ctx, `
		SELECT user_id FROM platform_users
		WHERE purge_after IS NOT NULL AND purge_after <= $1 AND deleted_at IS NULL
		ORDER BY purge_after`, now)
	// No LIMIT: a postponed account stays due for as long as it is postponed, and a batch cap
	// would let enough of those starve everyone queued behind them. Deletions per hour are few.
	if err != nil {
		return 0, err
	}
	var due []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return 0, err
		}
		due = append(due, id)
	}
	rows.Close()
	n := 0
	for _, id := range due {
		err := s.purge(ctx, id)
		var sole *SoleOwnerError
		switch {
		case errors.As(err, &sole):
			s.log().Warn("account purge postponed: the account became a workspace's only owner", "user", id, "workspaces", len(sole.Workspaces))
		case err != nil:
			s.log().Error("account purge", "user", id, "err", err)
		default:
			n++
		}
	}
	return n, nil
}

func (s *Service) purge(ctx context.Context, userID string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	// Locked, and re-read under the lock: a sign-in that cancels at the last moment wins.
	var pending bool
	if err := tx.QueryRowContext(ctx, `
		SELECT deletion_requested_at IS NOT NULL AND deleted_at IS NULL FROM platform_users
		WHERE user_id = $1 FOR UPDATE`, userID).Scan(&pending); err != nil || !pending {
		return err
	}
	owned, err := soleOwned(ctx, tx, userID)
	if err != nil {
		return err
	}
	if len(owned) > 0 {
		return &SoleOwnerError{Workspaces: owned}
	}
	if err := execAll(ctx, tx, userID,
		// The row others' work points at stays; what identified the person does not. "!" is not a
		// bcrypt hash, so no password can ever match it.
		`UPDATE users SET email = 'deleted-' || id || '@deleted.invalid', password_hash = '!', roles = '', permissions = '' WHERE id = $1`,
		`DELETE FROM user_profiles WHERE user_id = $1`,
		`DELETE FROM workspace_members WHERE user_id = $1`,
		`DELETE FROM project_members WHERE user_id = $1`,
		`DELETE FROM team_members WHERE user_id = $1`,
		`DELETE FROM task_assignees WHERE user_id = $1`,
		`DELETE FROM client_contacts WHERE user_id = $1`,
		`DELETE FROM notifications WHERE user_id = $1`,
		`DELETE FROM notification_prefs WHERE user_id = $1`,
		`DELETE FROM user_github_accounts WHERE user_id = $1`,
		`DELETE FROM account_codes WHERE user_id = $1`,
		// Minted during the grace period and never used to sign in are not possible (that would
		// cancel), but a purge is the last word, so it clears them regardless.
		`DELETE FROM personal_access_tokens WHERE user_id = $1`,
		`DELETE FROM mcp_tokens WHERE user_id = $1`,
		`DELETE FROM admin_mcp_tokens WHERE user_id = $1`,
		`DELETE FROM oauth_refresh_tokens WHERE user_id = $1`,
		`DELETE FROM oauth_codes WHERE user_id = $1`,
		`DELETE FROM push_subscriptions WHERE user_id = $1`,
		`DELETE FROM devices WHERE user_id = $1`,
		`UPDATE platform_users SET deleted_at = now(), purge_after = NULL, updated_at = now() WHERE user_id = $1`,
	); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	platform.Invalidate(userID)
	return nil
}

func execAll(ctx context.Context, tx *sql.Tx, userID string, stmts ...string) error {
	for _, q := range stmts {
		if _, err := tx.ExecContext(ctx, q, userID); err != nil {
			return errors.New(strings.Fields(q)[0] + " " + tableOf(q) + ": " + err.Error())
		}
	}
	return nil
}

// tableOf names the table in an error, so a failed purge says which step failed.
func tableOf(q string) string {
	f := strings.Fields(q)
	for i, w := range f {
		if (w == "FROM" || w == "UPDATE") && i+1 < len(f) {
			return f[i+1]
		}
	}
	return ""
}

func (s *Service) mailAsync(m mail.Message, what, userID string) {
	if s.Mail == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
		defer cancel()
		if err := s.Mail.Send(ctx, m); err != nil {
			s.log().Error("account mail: "+what, "user", userID, "err", err)
		}
	}()
}

// SoleOwnerRefusal is the 409 body: {"error", "code": "sole_owner", "workspaces": [...]}. It carries
// the list so a client can link to each workspace instead of leaving the person to go and find them.
type SoleOwnerRefusal struct {
	Code       string           `json:"code"`
	Msg        string           `json:"error"`
	Workspaces []OwnedWorkspace `json:"workspaces"`
}

func (e *SoleOwnerRefusal) Error() string  { return e.Msg }
func (e *SoleOwnerRefusal) GetStatus() int { return http.StatusConflict }

type deleteOut struct {
	Body struct {
		PurgeAfter time.Time `json:"purge_after" doc:"When the account is anonymised, unless you sign in before then"`
	}
}

// RegisterDelete mounts POST /api/me/delete.
func RegisterDelete(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{OperationID: "me-delete", Method: http.MethodPost, Path: "/api/me/delete",
		DefaultStatus: http.StatusAccepted, Tags: []string{"Account"},
		Summary: "Delete your account",
		Description: "Needs your password. Refused (409, code sole_owner, with the list) while you are the only owner of a workspace. " +
			"Otherwise every session and token ends now, and the account is anonymised after the grace period (purge_after). " +
			"Signing in again before then cancels the deletion.",
		Errors: []int{http.StatusForbidden, http.StatusConflict}},
		func(ctx context.Context, in *struct {
			Body struct {
				Password     string `json:"password" minLength:"1" maxLength:"200"`
				Code         string `json:"code,omitempty" maxLength:"6" doc:"Required when two-factor sign-in is on"`
				RecoveryCode string `json:"recovery_code,omitempty" maxLength:"20"`
				Locale       string `json:"locale,omitempty" enum:"en,ar,"`
			}
		}) (*deleteOut, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			purge, err := s.RequestDeletion(ctx, id, in.Body.Password, in.Body.Code, in.Body.RecoveryCode, in.Body.Locale)
			var sole *SoleOwnerError
			switch {
			case errors.Is(err, errWrongPassword):
				return nil, huma.Error403Forbidden(err.Error())
			case errors.Is(err, errSecondFactorRequired):
				return nil, &Refusal{Status: http.StatusForbidden, Code: "mfa_required", Msg: err.Error()}
			case errors.Is(err, ErrTOTPInvalid), errors.Is(err, ErrTOTPLocked):
				return nil, s.twoFAError(err)
			case errors.As(err, &sole):
				return nil, &SoleOwnerRefusal{Code: "sole_owner", Msg: sole.Error(), Workspaces: sole.Workspaces}
			case err != nil:
				s.log().Error("account delete", "err", err)
				return nil, huma.Error500InternalServerError("could not delete the account")
			}
			out := &deleteOut{}
			out.Body.PurgeAfter = purge
			return out, nil
		})
}
