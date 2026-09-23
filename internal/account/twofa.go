package account

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1" //#nosec G505 -- RFC 6238 TOTP is defined over HMAC-SHA1; every authenticator app speaks it
	"crypto/sha256"
	"database/sql"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"strings"
	"time"

	"golang.org/x/crypto/bcrypt"

	"github.com/fadymondy/mahaam/internal/secretbox"
)

/*
Two-factor sign-in (MH-341): TOTP from an authenticator app, plus ten one-time recovery codes.

The auth plugin has /api/auth/2fa/enroll and /verify, but sign-in never asks for a code, so turning
2FA on there protected nothing. It also stores the secret in plain text under the issuer "togo".
Mahaam does it here instead and the guard blocks the plugin's two routes.

How sign-in works with it on (server/guard.go → LoginChallenge):

  1. POST /api/auth/login {email, password}
     wrong password         → passed to the plugin untouched: the same 401, the same rate limit,
                              and nothing that reveals whether the account has 2FA
     right password, 2FA on → 401 {code: "mfa_required", challenge}, and NO session
  2. POST /api/auth/2fa/challenge {challenge, code | recovery_code} → the session

The challenge is sealed (secretbox): the user, an expiry five minutes out, and a fingerprint of the
password hash. So it can't be forged, doesn't outlive a password change, and holds nothing secret.
*/

const (
	totpStep   = 30 * time.Second
	totpDigits = 6
	// A code from the step before or after is accepted as well: phones drift, and people type slowly.
	totpSkew = 1
	// Wrong second factors per window, counted in the database so the limit holds across
	// instances. Ten tries at a million values each is 1 in 100,000 per window.
	maxTOTPFailures = 10
	totpFailWindow  = 15 * time.Minute
	challengeTTL    = 5 * time.Minute
	recoveryCodes   = 10
)

var (
	ErrTOTPInvalid     = errors.New("that code isn't right")
	ErrTOTPLocked      = errors.New("too many wrong codes; wait a few minutes and try again")
	ErrTOTPNotEnabled  = errors.New("two-factor sign-in is not on")
	ErrTOTPEnabled     = errors.New("two-factor sign-in is already on; turn it off first to set it up again")
	ErrTOTPNotEnrolled = errors.New("start the setup first")
	ErrChallenge       = errors.New("the sign-in expired; enter your password again")

	errSecondFactorRequired = errors.New("enter a code from your authenticator app as well")
)

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func newTOTPSecret() (string, error) {
	b := make([]byte, 20) // 160 bits, RFC 4226's recommendation
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return b32.EncodeToString(b), nil
}

// totpAt is RFC 6238 for one step.
func totpAt(secret []byte, step int64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], uint64(step))
	m := hmac.New(sha1.New, secret)
	m.Write(msg[:])
	sum := m.Sum(nil)
	off := sum[len(sum)-1] & 0x0f
	v := binary.BigEndian.Uint32(sum[off:off+4]) & 0x7fffffff
	return fmt.Sprintf("%0*d", totpDigits, v%1_000_000)
}

// matchTOTP returns the step code matches within the skew, provided it is later than lastStep.
func matchTOTP(secretB32, code string, now time.Time, lastStep int64) (int64, bool) {
	code = strings.ReplaceAll(strings.TrimSpace(code), " ", "")
	if len(code) != totpDigits {
		return 0, false
	}
	secret, err := b32.DecodeString(strings.ToUpper(secretB32))
	if err != nil {
		return 0, false
	}
	now64 := now.Unix() / int64(totpStep/time.Second)
	for d := -totpSkew; d <= totpSkew; d++ {
		step := now64 + int64(d)
		if step <= lastStep {
			continue // already used: a replayed code
		}
		if hmac.Equal([]byte(totpAt(secret, step)), []byte(code)) {
			return step, true
		}
	}
	return 0, false
}

// otpauthURL is what the QR code holds, and what an authenticator on the same phone opens.
func otpauthURL(email, secret string) string {
	label := url.PathEscape("Mahaam:" + email)
	q := url.Values{"secret": {secret}, "issuer": {"Mahaam"}, "algorithm": {"SHA1"}, "digits": {"6"}, "period": {"30"}}
	return "otpauth://totp/" + label + "?" + q.Encode()
}

// ---- recovery codes ---------------------------------------------------------------------------

// Recovery codes are ten characters from an alphabet without look-alikes (no 0/o, 1/l/i), shown
// as xxxxx-xxxxx. 50 bits each, and each works once.
const recoveryAlphabet = "abcdefghjkmnpqrstuvwxyz23456789"

func newRecoveryCode() (string, error) {
	b := make([]byte, 10)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	out := make([]byte, 0, 11)
	for i, c := range b {
		if i == 5 {
			out = append(out, '-')
		}
		out = append(out, recoveryAlphabet[int(c)%len(recoveryAlphabet)])
	}
	return string(out), nil
}

func normRecovery(code string) string {
	return strings.ToLower(strings.NewReplacer("-", "", " ", "").Replace(strings.TrimSpace(code)))
}

func hashRecovery(userID, code string) (string, error) {
	sig := secretbox.Sign([]byte("recovery:" + userID + ":" + normRecovery(code)))
	if sig == "" {
		return "", errors.New("recovery codes need the server secret key")
	}
	return sig, nil
}

// replaceRecoveryCodes issues a fresh set, invalidating the old one, inside tx.
func replaceRecoveryCodes(ctx context.Context, tx *sql.Tx, userID string) ([]string, error) {
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_recovery_codes WHERE user_id = $1`, userID); err != nil {
		return nil, err
	}
	codes := make([]string, 0, recoveryCodes)
	for i := 0; i < recoveryCodes; i++ {
		c, err := newRecoveryCode()
		if err != nil {
			return nil, err
		}
		h, err := hashRecovery(userID, c)
		if err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_recovery_codes (user_id, code_hash) VALUES ($1, $2)`, userID, h); err != nil {
			return nil, err
		}
		codes = append(codes, c)
	}
	return codes, nil
}

// ---- state ------------------------------------------------------------------------------------

// TwoFAState is what the account screen shows.
type TwoFAState struct {
	Enabled      bool `json:"enabled"`
	Pending      bool `json:"pending" doc:"Setup started (QR shown) but no code confirmed yet"`
	RecoveryLeft int  `json:"recovery_codes_left"`
}

// TwoFAEnabled reports whether userID must give a second factor to sign in.
func TwoFAEnabled(ctx context.Context, db *sql.DB, userID string) bool {
	var on bool
	_ = db.QueryRowContext(ctx, `SELECT enabled_at IS NOT NULL FROM user_totp WHERE user_id = $1`, userID).Scan(&on)
	return on
}

func (s *Service) TwoFA(ctx context.Context, userID string) (TwoFAState, error) {
	var st TwoFAState
	var enabled sql.NullTime
	err := s.DB.QueryRowContext(ctx, `SELECT enabled_at FROM user_totp WHERE user_id = $1`, userID).Scan(&enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return st, nil
	}
	if err != nil {
		return st, err
	}
	st.Enabled, st.Pending = enabled.Valid, !enabled.Valid
	err = s.DB.QueryRowContext(ctx, `SELECT count(*) FROM user_recovery_codes WHERE user_id = $1 AND used_at IS NULL`, userID).Scan(&st.RecoveryLeft)
	return st, err
}

// checkPassword compares against the account's bcrypt hash.
func (s *Service) checkPassword(ctx context.Context, userID, password string) (email string, err error) {
	var hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT email, password_hash FROM users WHERE id = $1`, userID).Scan(&email, &hash); err != nil {
		return "", err
	}
	if bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", errWrongPassword
	}
	return email, nil
}

// Enroll starts setup: a new secret, not yet enforced. It needs the password, because turning 2FA
// on is also a way to lock the owner out: someone at an unlocked laptop could otherwise enrol their
// own phone.
func (s *Service) Enroll(ctx context.Context, userID, password string) (secret, uri string, err error) {
	email, err := s.checkPassword(ctx, userID, password)
	if err != nil {
		return "", "", err
	}
	if TwoFAEnabled(ctx, s.DB, userID) {
		return "", "", ErrTOTPEnabled
	}
	secret, err = newTOTPSecret()
	if err != nil {
		return "", "", err
	}
	sealed, err := secretbox.Seal([]byte(secret))
	if err != nil {
		return "", "", err
	}
	if _, err := s.DB.ExecContext(ctx, `
		INSERT INTO user_totp (user_id, secret_sealed) VALUES ($1, $2)
		ON CONFLICT (user_id) DO UPDATE SET secret_sealed = EXCLUDED.secret_sealed, enabled_at = NULL,
			last_step = 0, failures = 0, failures_reset_at = now()`, userID, sealed); err != nil {
		return "", "", err
	}
	return secret, otpauthURL(email, secret), nil
}

// Confirm turns 2FA on with the first code from the app, and returns the recovery codes, once.
func (s *Service) Confirm(ctx context.Context, userID, code string) ([]string, error) {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	var sealed string
	var enabled sql.NullTime
	err = tx.QueryRowContext(ctx, `SELECT secret_sealed, enabled_at FROM user_totp WHERE user_id = $1 FOR UPDATE`, userID).Scan(&sealed, &enabled)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrTOTPNotEnrolled
	}
	if err != nil {
		return nil, err
	}
	if enabled.Valid {
		return nil, ErrTOTPEnabled
	}
	secret, err := secretbox.Open(sealed)
	if err != nil {
		return nil, err
	}
	step, ok := matchTOTP(string(secret), code, time.Now(), 0)
	if !ok {
		return nil, ErrTOTPInvalid
	}
	if _, err := tx.ExecContext(ctx, `UPDATE user_totp SET enabled_at = now(), last_step = $2 WHERE user_id = $1`, userID, step); err != nil {
		return nil, err
	}
	codes, err := replaceRecoveryCodes(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	return codes, tx.Commit()
}

// SecondFactor checks a TOTP code or a recovery code for userID and spends it. Wrong answers are
// counted; past maxTOTPFailures in a window every answer is refused until the window ends.
func (s *Service) SecondFactor(ctx context.Context, userID, code, recovery string) error {
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	var sealed string
	var enabled sql.NullTime
	var lastStep int64
	var failures int
	var resetAt time.Time
	err = tx.QueryRowContext(ctx, `
		SELECT secret_sealed, enabled_at, last_step, failures, failures_reset_at FROM user_totp
		WHERE user_id = $1 FOR UPDATE`, userID).Scan(&sealed, &enabled, &lastStep, &failures, &resetAt)
	if errors.Is(err, sql.ErrNoRows) || (err == nil && !enabled.Valid) {
		return ErrTOTPNotEnabled
	}
	if err != nil {
		return err
	}
	if time.Now().After(resetAt) {
		failures = 0
	}
	if failures >= maxTOTPFailures {
		return ErrTOTPLocked
	}

	ok := false
	switch {
	case strings.TrimSpace(recovery) != "":
		h, err := hashRecovery(userID, recovery)
		if err != nil {
			return err
		}
		res, err := tx.ExecContext(ctx, `UPDATE user_recovery_codes SET used_at = now()
			WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL`, userID, h)
		if err != nil {
			return err
		}
		n, _ := res.RowsAffected()
		ok = n == 1
	default:
		secret, err := secretbox.Open(sealed)
		if err != nil {
			return err
		}
		var step int64
		if step, ok = matchTOTP(string(secret), code, time.Now(), lastStep); ok {
			if _, err := tx.ExecContext(ctx, `UPDATE user_totp SET last_step = $2 WHERE user_id = $1`, userID, step); err != nil {
				return err
			}
		}
	}
	if ok {
		if _, err := tx.ExecContext(ctx, `UPDATE user_totp SET failures = 0 WHERE user_id = $1`, userID); err != nil {
			return err
		}
		return tx.Commit()
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE user_totp SET
			failures = CASE WHEN failures_reset_at < now() THEN 1 ELSE failures + 1 END,
			failures_reset_at = CASE WHEN failures_reset_at < now() THEN now() + $2 * interval '1 second' ELSE failures_reset_at END
		WHERE user_id = $1`, userID, int(totpFailWindow/time.Second)); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return ErrTOTPInvalid
}

// RegenerateRecovery replaces the recovery codes. Password and a current code both, because the
// old codes stop working and the new ones are shown.
func (s *Service) RegenerateRecovery(ctx context.Context, userID, password, code string) ([]string, error) {
	if _, err := s.checkPassword(ctx, userID, password); err != nil {
		return nil, err
	}
	if err := s.SecondFactor(ctx, userID, code, ""); err != nil {
		return nil, err
	}
	tx, err := s.DB.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback() }()
	codes, err := replaceRecoveryCodes(ctx, tx, userID)
	if err != nil {
		return nil, err
	}
	return codes, tx.Commit()
}

// DisableTwoFA turns it off: the password and a code (or a recovery code), so neither a stolen
// session nor a stolen password alone can remove the second factor.
func (s *Service) DisableTwoFA(ctx context.Context, userID, password, code, recovery string) error {
	if _, err := s.checkPassword(ctx, userID, password); err != nil {
		return err
	}
	if err := s.SecondFactor(ctx, userID, code, recovery); err != nil {
		return err
	}
	_, err := s.DB.ExecContext(ctx, `DELETE FROM user_totp WHERE user_id = $1`, userID)
	if err != nil {
		return err
	}
	_, err = s.DB.ExecContext(ctx, `DELETE FROM user_recovery_codes WHERE user_id = $1`, userID)
	return err
}

// ---- the sign-in challenge --------------------------------------------------------------------

type challenge struct {
	User string `json:"u"`
	Exp  int64  `json:"e"`
	// A fingerprint of the password hash: a password change (or reset) voids challenges issued
	// under the old one.
	PW string `json:"p"`
}

func pwFingerprint(hash string) string {
	sum := sha256.Sum256([]byte("challenge:" + hash))
	return hex.EncodeToString(sum[:8])
}

// LoginChallenge is the guard's question at POST /api/auth/login: does this sign-in need a second
// factor? Only when the password is RIGHT and the account has 2FA on; then it returns a challenge
// and the guard answers instead of the plugin. A wrong password returns ("", false) and goes to
// the plugin, which answers it exactly as it would for any account.
func (s *Service) LoginChallenge(ctx context.Context, email, password string) (string, bool) {
	var id, hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT id, password_hash FROM users WHERE lower(email) = lower($1)`,
		strings.TrimSpace(email)).Scan(&id, &hash); err != nil {
		return "", false
	}
	if !TwoFAEnabled(ctx, s.DB, id) || bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) != nil {
		return "", false
	}
	b, _ := json.Marshal(challenge{User: id, Exp: time.Now().Add(challengeTTL).Unix(), PW: pwFingerprint(hash)})
	sealed, err := secretbox.Seal(b)
	if err != nil {
		return "", false
	}
	return sealed, true
}

// SignInChallenge is LoginChallenge for a sign-in whose first factor was proved some other way
// (Sign in with Apple, Google/GitHub): the same sealed challenge, finished at
// POST /api/auth/2fa/challenge. The caller has already established that 2FA is on.
func (s *Service) SignInChallenge(ctx context.Context, userID string) (string, error) {
	var hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1`, userID).Scan(&hash); err != nil {
		return "", err
	}
	b, _ := json.Marshal(challenge{User: userID, Exp: time.Now().Add(challengeTTL).Unix(), PW: pwFingerprint(hash)})
	return secretbox.Seal(b)
}

// OpenChallenge returns the user a challenge was issued for, if it is genuine, unexpired, and the
// password has not changed since.
func (s *Service) OpenChallenge(ctx context.Context, sealed string) (string, error) {
	raw, err := secretbox.Open(strings.TrimSpace(sealed))
	if err != nil {
		return "", ErrChallenge
	}
	var c challenge
	if json.Unmarshal(raw, &c) != nil || time.Now().Unix() > c.Exp {
		return "", ErrChallenge
	}
	var hash string
	if err := s.DB.QueryRowContext(ctx, `SELECT password_hash FROM users WHERE id = $1`, c.User).Scan(&hash); err != nil {
		return "", ErrChallenge
	}
	if !hmac.Equal([]byte(pwFingerprint(hash)), []byte(c.PW)) {
		return "", ErrChallenge
	}
	return c.User, nil
}
