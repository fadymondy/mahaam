package account

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/auth"
	"github.com/togo-framework/ratelimit"
	"github.com/togo-framework/togo"

	"github.com/fadymondy/mahaam/internal/mailer"
)

/*
Email verification (MH-342).

A code goes out when an account is created: the auth plugin fires auth.registered and
OnRegistered listens, so the plugin's handler is untouched. The person enters it at

	POST /api/me/verify-email         {code}
	POST /api/me/verify-email/resend

(under /api/me rather than /api/auth: these need the session, and the guard leaves /api/auth/* to
the plugin, which would never see one). Until then they can sign in and use everything they were
invited to; what's gated is creating a workspace, the one thing that starts something new under
an address nobody has proved.

Whether that gate applies is EMAIL_VERIFICATION:

	auto      (default) required when mail really leaves the server, off when it doesn't
	required  always
	off       never

"auto" exists because production has no SMTP yet (MH-162). Requiring a code nobody can receive
would stop every new sign-up dead, and it would do it silently.

Anything else that proves the inbox counts as verification too: a password reset by emailed code,
and confirming a changed address.
*/

// VerificationRequired reports whether unverified accounts are gated.
func VerificationRequired(mail mailer.Sender) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("EMAIL_VERIFICATION"))) {
	case "required":
		return true
	case "off":
		return false
	}
	return mail != nil && mailer.Delivers(mail.Driver())
}

// ErrUnverified is the gate's refusal.
var ErrUnverified = errors.New("confirm your email address first: enter the code we sent you")

// Verified reports whether userID has proved their address.
func Verified(ctx context.Context, db *sql.DB, userID string) bool {
	var ok bool
	_ = db.QueryRowContext(ctx, `SELECT email_verified_at IS NOT NULL FROM platform_users WHERE user_id = $1`, userID).Scan(&ok)
	return ok
}

// RequireVerified is the gate: nil when verification is off or done.
func RequireVerified(ctx context.Context, db *sql.DB, mail mailer.Sender, userID string) error {
	if !VerificationRequired(mail) || Verified(ctx, db, userID) {
		return nil
	}
	return ErrUnverified
}

// markVerified records proof of the inbox. q is the transaction that proved it, when there is one.
func markVerified(ctx context.Context, q interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}, userID string) error {
	_, err := q.ExecContext(ctx, `
		INSERT INTO platform_users (user_id, email_verified_at, updated_at) VALUES ($1, now(), now())
		ON CONFLICT (user_id) DO UPDATE SET email_verified_at = coalesce(platform_users.email_verified_at, now()), updated_at = now()`, userID)
	return err
}

// SendVerification issues a fresh code and mails it.
func (s *Service) SendVerification(ctx context.Context, userID, locale string) error {
	var email string
	if err := s.DB.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
		return err
	}
	code, err := Issue(ctx, s.DB, userID, PurposeEmailVerify, email)
	if err != nil {
		return err
	}
	s.mailAsync(verifyMail(email, code, locale), "verification", userID)
	return nil
}

// ConfirmVerification spends the code. The code is bound to the address it was sent to, so a code
// issued before an email change can't verify the new address.
func (s *Service) ConfirmVerification(ctx context.Context, userID, code string) error {
	return Consume(ctx, s.DB, userID, PurposeEmailVerify, strings.TrimSpace(code), func(tx *sql.Tx, target string) error {
		var email string
		if err := tx.QueryRowContext(ctx, `SELECT email FROM users WHERE id = $1`, userID).Scan(&email); err != nil {
			return err
		}
		if !strings.EqualFold(email, target) {
			return ErrInvalidCode
		}
		return markVerified(ctx, tx, userID)
	})
}

// OnRegistered sends the first code when the auth plugin creates an account. It runs inside the
// register request, so the send happens off it: registration must not wait on SMTP.
func OnRegistered(k *togo.Kernel, s *Service) {
	if k == nil || k.Hooks == nil {
		return
	}
	k.Hooks.On(auth.EventRegistered, 50, func(_ context.Context, payload any) error {
		var id string
		switch u := payload.(type) {
		case auth.User:
			id = u.ID
		case *auth.User:
			id = u.ID
		}
		if id == "" {
			return nil // the supabase driver's payload carries no id; nothing to verify here
		}
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.SendVerification(ctx, id, ""); err != nil {
				s.log().Error("verification: first code", "user", id, "err", err)
			}
		}()
		return nil
	})
}

var verifyResendPerUser = ratelimit.Rate("verify-resend", 3, 15*time.Minute)

type verifyState struct {
	Body struct {
		Verified bool `json:"email_verified"`
		Required bool `json:"email_verification_required" doc:"Unverified accounts can't create a workspace on this server"`
	}
}

// RegisterVerify mounts the verification routes.
func RegisterVerify(api huma.API, s *Service) {
	state := func(ctx context.Context, userID string) *verifyState {
		out := &verifyState{}
		out.Body.Verified = Verified(ctx, s.DB, userID)
		out.Body.Required = VerificationRequired(s.Mail)
		return out
	}
	huma.Register(api, huma.Operation{OperationID: "me-verify-email-state", Method: http.MethodGet, Path: "/api/me/verify-email",
		Summary: "Whether your email address is confirmed", Tags: []string{"Account"}},
		func(ctx context.Context, _ *struct{}) (*verifyState, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			return state(ctx, id), nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-verify-email", Method: http.MethodPost, Path: "/api/me/verify-email",
		Summary: "Confirm your email address with the code sent to it", Tags: []string{"Account"}},
		func(ctx context.Context, in *struct {
			Body struct {
				Code string `json:"code" pattern:"^[0-9]{6}$"`
			}
		}) (*verifyState, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if Verified(ctx, s.DB, id) {
				return state(ctx, id), nil
			}
			switch err := s.ConfirmVerification(ctx, id, in.Body.Code); {
			case errors.Is(err, ErrInvalidCode):
				return nil, huma.Error400BadRequest(err.Error())
			case err != nil:
				s.log().Error("verify email", "err", err)
				return nil, huma.Error500InternalServerError("could not confirm the address")
			}
			return state(ctx, id), nil
		})

	huma.Register(api, huma.Operation{OperationID: "me-verify-email-resend", Method: http.MethodPost, Path: "/api/me/verify-email/resend",
		DefaultStatus: http.StatusAccepted, Summary: "Send a new confirmation code", Tags: []string{"Account"}},
		func(ctx context.Context, in *struct {
			// Optional: a bare POST is the usual call.
			Body *struct {
				Locale string `json:"locale,omitempty" enum:"en,ar,"`
			}
		}) (*struct{}, error) {
			id, err := who(ctx)
			if err != nil {
				return nil, err
			}
			if Verified(ctx, s.DB, id) {
				return nil, nil
			}
			if s.Limit != nil {
				if ok, _ := s.Limit.Allow(ctx, id, verifyResendPerUser); !ok {
					return nil, huma.Error429TooManyRequests("too many codes requested; try again later")
				}
			}
			locale := ""
			if in.Body != nil {
				locale = in.Body.Locale
			}
			if err := s.SendVerification(ctx, id, locale); err != nil {
				s.log().Error("verify email: resend", "err", err)
				return nil, huma.Error500InternalServerError("could not send a code")
			}
			return nil, nil
		})
}

// Refusal is a coded API error: {"error", "code"} with a status, the shape the web reads for
// refusals it handles specially (limits.Exceeded is the same idea).
type Refusal struct {
	Status int    `json:"-"`
	Code   string `json:"code"`
	Msg    string `json:"error"`
}

func (e *Refusal) Error() string  { return e.Msg }
func (e *Refusal) GetStatus() int { return e.Status }

// Unverified is the gate's answer: 403, code email_unverified.
func Unverified() *Refusal {
	return &Refusal{Status: http.StatusForbidden, Code: "email_unverified", Msg: ErrUnverified.Error()}
}
