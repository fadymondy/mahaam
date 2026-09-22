package account

import (
	"context"
	"database/sql"
	"errors"
	"log/slog"
	"net"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/danielgtaylor/huma/v2"
	"github.com/togo-framework/ratelimit"
	"golang.org/x/crypto/bcrypt"

	"github.com/fadymondy/mahaam/internal/mailer"
	"github.com/fadymondy/mahaam/internal/platform"
)

/*
Forgot password (MH-340).

	POST /api/auth/password/forgot {email, locale?}          → 202, always
	POST /api/auth/password/reset  {email, code, new_password} → 204, or 400 for any bad code

The shape is two calls and no link on purpose. A link needs a web page to land on, and the phone
app would have to claim that URL to open it. A six-digit code is typed wherever the person
already is: web, phone or desktop.

"Always 202" is only half of not revealing who has an account. The other half is TIME: looking
the user up, writing a code and talking to an SMTP server takes hundreds of milliseconds that an
unknown address would skip, and that gap answers the question the status code refuses to. So the
response goes out before any of it, and the work happens afterwards off the request.

A successful reset ends every session the account holds: its JWTs (sessions_valid_after) and its
personal access tokens (deleted). Whoever set the password they forgot may still hold one. It
does not sign the caller in. The client signs in with the new password, which is one more request
and keeps session creation in one place, the auth plugin's login.

MCP tokens (mgy_) are left alone, the same as an admin's "sign out everywhere". They are
workspace-scoped, listed and revoked in the workspace.
*/

// Service holds what the password routes need.
type Service struct {
	DB    *sql.DB // owner pool
	Mail  mailer.Sender
	Log   *slog.Logger
	Limit *ratelimit.Service // nil: not rate limited (development without the plugin)
}

var (
	forgotPerIP    = ratelimit.Rate("password-forgot-ip", 10, time.Hour)
	forgotPerEmail = ratelimit.Rate("password-forgot-email", 3, 15*time.Minute)
	resetPerIP     = ratelimit.Rate("password-reset-ip", 20, 15*time.Minute)
)

type forgotIn struct {
	Body struct {
		Email  string `json:"email" format:"email" maxLength:"320"`
		Locale string `json:"locale,omitempty" enum:"en,ar," doc:"Language of the email. Default en."`
	}
}

type resetIn struct {
	Body struct {
		Email       string `json:"email" format:"email" maxLength:"320"`
		Code        string `json:"code" minLength:"6" maxLength:"6" pattern:"^[0-9]{6}$"`
		NewPassword string `json:"new_password" minLength:"1" maxLength:"200"`
		Locale      string `json:"locale,omitempty" enum:"en,ar," doc:"Language of the \"your password was changed\" email. Default en."`
	}
}

// Register mounts the password routes. Both are public (the guard passes /api/auth/*), so each
// carries its own rate limit.
func Register(api huma.API, s *Service) {
	huma.Register(api, huma.Operation{
		OperationID: "password-forgot", Method: http.MethodPost, Path: "/api/auth/password/forgot",
		DefaultStatus: http.StatusAccepted, Tags: []string{"Account"},
		Summary:     "Email a password-reset code",
		Description: "Always answers 202, whether or not the address has an account, and in the same time either way. A code is valid for 10 minutes and 5 attempts; asking again replaces it.",
		Middlewares: huma.Middlewares{s.limit(forgotPerIP)},
	}, func(ctx context.Context, in *forgotIn) (*struct{}, error) {
		email := normEmail(in.Body.Email)
		if email == "" {
			return nil, huma.Error422UnprocessableEntity("email is required")
		}
		// Over the per-address limit: still 202, and nothing is sent. Answering 429 here would
		// say "this address is being asked about", which is its own small leak.
		if s.Limit != nil {
			if ok, _ := s.Limit.Allow(ctx, email, forgotPerEmail); !ok {
				return nil, nil
			}
		}
		go s.sendReset(email, in.Body.Locale)
		return nil, nil
	})

	huma.Register(api, huma.Operation{
		OperationID: "password-reset", Method: http.MethodPost, Path: "/api/auth/password/reset",
		DefaultStatus: http.StatusNoContent, Tags: []string{"Account"},
		Summary:     "Set a new password with an emailed code",
		Description: "Signs the account out everywhere: every session and personal access token it held stops working. Sign in again with the new password.",
		Middlewares: huma.Middlewares{s.limit(resetPerIP)},
	}, func(ctx context.Context, in *resetIn) (*struct{}, error) {
		if err := validatePassword(in.Body.NewPassword); err != nil {
			return nil, huma.Error422UnprocessableEntity(err.Error())
		}
		err := s.Reset(ctx, in.Body.Email, in.Body.Code, in.Body.NewPassword, in.Body.Locale)
		if errors.Is(err, ErrInvalidCode) {
			return nil, huma.Error400BadRequest(ErrInvalidCode.Error())
		}
		if err != nil {
			s.log().Error("password reset", "err", err)
			return nil, huma.Error500InternalServerError("could not reset the password")
		}
		return nil, nil
	})
}

// sendReset runs off the request path: see the comment at the top of this file for why.
func (s *Service) sendReset(email, locale string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var userID string
	err := s.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = $1`, email).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		return // no account: nothing to send, and nothing said about it
	}
	if err != nil {
		s.log().Error("password forgot: user lookup", "err", err)
		return
	}
	code, err := Issue(ctx, s.DB, userID, PurposePasswordReset, "")
	if err != nil {
		s.log().Error("password forgot: issue code", "err", err)
		return
	}
	if s.Mail == nil {
		s.log().Warn("password forgot: no mail service, so the code was not sent", "user", userID)
		return
	}
	if err := s.Mail.Send(ctx, resetMail(email, code, locale)); err != nil {
		s.log().Error("password forgot: send", "user", userID, "err", err)
	}
}

// Reset spends a password_reset code and, in the same transaction, sets the password and ends
// every session the account holds.
func (s *Service) Reset(ctx context.Context, email, code, password, locale string) error {
	// Hashed FIRST, for every request. bcrypt is the slow part, around 60 ms, and doing it only
	// for a known address would let anyone time this endpoint to learn who has an account, which
	// is exactly what forgot's "always 202" refuses to say. It also runs before the transaction,
	// so no row lock is held across it.
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	var userID string
	err = s.DB.QueryRowContext(ctx, `SELECT id FROM users WHERE lower(email) = $1`, normEmail(email)).Scan(&userID)
	if errors.Is(err, sql.ErrNoRows) {
		// The same answer as a wrong code. "No such account" would undo everything forgot does
		// to keep that quiet.
		return ErrInvalidCode
	}
	if err != nil {
		return err
	}
	err = Consume(ctx, s.DB, userID, PurposePasswordReset, strings.TrimSpace(code), func(tx *sql.Tx, _ string) error {
		if _, err := tx.ExecContext(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, userID, string(hash)); err != nil {
			return err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM personal_access_tokens WHERE user_id = $1`, userID); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx, `
			INSERT INTO platform_users (user_id, sessions_valid_after, updated_at) VALUES ($1, now(), now())
			ON CONFLICT (user_id) DO UPDATE SET sessions_valid_after = now(), updated_at = now()`, userID)
		return err
	})
	if err != nil {
		return err
	}
	platform.Invalidate(userID)
	if s.Mail != nil {
		// Tell the owner of the address. If they did not ask for this, it's the first they hear
		// of someone else holding their inbox. Best effort: the reset has already happened.
		go func() {
			ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
			defer cancel()
			if err := s.Mail.Send(ctx, changedMail(normEmail(email), locale)); err != nil {
				s.log().Error("password reset: notice", "user", userID, "err", err)
			}
		}()
	}
	return nil
}

// limit is a per-client-IP rate limit, answered with 429 and Retry-After.
func (s *Service) limit(p ratelimit.Policy) func(huma.Context, func(huma.Context)) {
	return func(ctx huma.Context, next func(huma.Context)) {
		if s.Limit == nil {
			next(ctx)
			return
		}
		ok, retry := s.Limit.Allow(ctx.Context(), clientIP(ctx), p)
		if !ok {
			ctx.SetHeader("Retry-After", strconv.Itoa(int(retry/time.Second)+1))
			ctx.SetStatus(http.StatusTooManyRequests)
			ctx.SetHeader("Content-Type", "application/json")
			_, _ = ctx.BodyWriter().Write([]byte(`{"title":"Too Many Requests","status":429,"detail":"too many attempts; try again later"}`))
			return
		}
		next(ctx)
	}
}

// clientIP is the address to rate-limit by. The guard has already dropped forwarding headers
// that did not come from a trusted proxy (server/proxies.go), so what is left can be believed.
// The LAST X-Forwarded-For hop is the one our proxy added, so it's the one used: earlier hops
// are whatever the client chose to send.
func clientIP(ctx huma.Context) string {
	if ip := strings.TrimSpace(ctx.Header("Cf-Connecting-Ip")); ip != "" {
		return ip
	}
	if xff := ctx.Header("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
			return ip
		}
	}
	if h, _, err := net.SplitHostPort(ctx.RemoteAddr()); err == nil {
		return h
	}
	return ctx.RemoteAddr()
}

func (s *Service) log() *slog.Logger {
	if s.Log != nil {
		return s.Log
	}
	return slog.Default()
}

func normEmail(e string) string { return strings.ToLower(strings.TrimSpace(e)) }

// validatePassword is the auth plugin's policy (auth@v0.8.0 routes.go), which it does not export:
// AUTH_MIN_PASSWORD (default 8) and bcrypt's 72-byte ceiling. A reset must not be a way around the
// rules that registration enforces.
func validatePassword(p string) error {
	min := 8
	if v, err := strconv.Atoi(os.Getenv("AUTH_MIN_PASSWORD")); err == nil && v > 0 {
		min = v
	}
	if len(p) < min {
		return errors.New("password must be at least " + strconv.Itoa(min) + " characters")
	}
	if len(p) > 72 {
		return errors.New("password must be at most 72 bytes")
	}
	return nil
}
