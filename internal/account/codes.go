// Package account is what a person can do to their own account without being signed in to it,
// or before a workspace exists: reset a forgotten password today, and verify an email address
// next.
//
// Everything here runs on the owner pool. `users` and `account_codes` belong to no workspace,
// so the app role has no grant on either.
package account

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"database/sql"
	"errors"
	"fmt"
	"math/big"
	"time"

	"github.com/fadymondy/mahaam/internal/secretbox"
)

// Purpose is what a code unlocks. The values match the table's CHECK.
type Purpose string

const (
	PurposePasswordReset Purpose = "password_reset"
	PurposeEmailVerify   Purpose = "email_verify"
	PurposeEmailChange   Purpose = "email_change"
)

const (
	// CodeTTL is how long a mailed code works. Long enough to switch to the mail app and back on
	// a phone, short enough that a code in an old inbox is dead.
	CodeTTL = 10 * time.Minute
	// MaxAttempts wrong guesses burn a code. It is the real brute-force defence: the rate
	// limiter is in memory and per instance, but this count is in the database, so it holds
	// however many instances an attacker spreads the guesses across. Five tries at a million
	// values is a 1-in-200,000 chance per code.
	MaxAttempts = 5
)

// ErrInvalidCode is every way a code can fail: wrong, expired, used, burned, or never sent. They
// are one error on purpose. Telling them apart would tell a guesser which ones are worth another
// try.
var ErrInvalidCode = errors.New("that code is not valid, or it has expired")

// newCode is six decimal digits from crypto/rand, zero-padded.
func newCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(1_000_000))
	if err != nil {
		return "", err
	}
	return fmt.Sprintf("%06d", n.Int64()), nil
}

// hashCode keys the code to its purpose and its owner, so a code mailed for one thing can never
// be spent on another, even by the same person.
func hashCode(p Purpose, userID, code string) (string, error) {
	sig := secretbox.Sign([]byte("account-code:" + string(p) + ":" + userID + ":" + code))
	if sig == "" {
		// An empty signature would make every code hash to the same value, and so every code
		// correct. Refuse instead.
		return "", errors.New("account codes need the server secret key")
	}
	return sig, nil
}

// Issue replaces any live code the user has for p with a new one and returns it in plain text,
// once, to be mailed. target is stored alongside (the new address for an email change).
func Issue(ctx context.Context, db *sql.DB, userID string, p Purpose, target string) (string, error) {
	code, err := newCode()
	if err != nil {
		return "", err
	}
	h, err := hashCode(p, userID, code)
	if err != nil {
		return "", err
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	if _, err := tx.ExecContext(ctx, `DELETE FROM account_codes WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`, userID, string(p)); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO account_codes (user_id, purpose, code_hash, target, expires_at)
		VALUES ($1, $2, $3, $4, now() + $5 * interval '1 second')`,
		userID, string(p), h, target, int(CodeTTL/time.Second)); err != nil {
		return "", err
	}
	return code, tx.Commit()
}

// Consume checks code against the user's live code for p. On a match the code is spent and then
// apply runs in the SAME transaction, so the code and the change it authorises commit together
// or not at all. A code can't be spent on a change that then fails to save.
//
// On a miss the attempt is counted and committed before returning ErrInvalidCode, and the code is
// burned at MaxAttempts.
func Consume(ctx context.Context, db *sql.DB, userID string, p Purpose, code string, apply func(tx *sql.Tx, target string) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()

	var id, stored, target string
	var attempts int
	var expires time.Time
	// FOR UPDATE: two guesses racing each other must both be counted, not both read attempts=4.
	err = tx.QueryRowContext(ctx, `
		SELECT id, code_hash, target, attempts, expires_at FROM account_codes
		WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL FOR UPDATE`, userID, string(p),
	).Scan(&id, &stored, &target, &attempts, &expires)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrInvalidCode
	}
	if err != nil {
		return err
	}
	if time.Now().After(expires) || attempts >= MaxAttempts {
		return ErrInvalidCode
	}

	want, err := hashCode(p, userID, code)
	if err != nil {
		return err
	}
	if !hmac.Equal([]byte(want), []byte(stored)) {
		if _, err := tx.ExecContext(ctx, `
			UPDATE account_codes SET attempts = attempts + 1,
				used_at = CASE WHEN attempts + 1 >= $2 THEN now() END
			WHERE id = $1`, id, MaxAttempts); err != nil {
			return err
		}
		if err := tx.Commit(); err != nil {
			return err
		}
		return ErrInvalidCode
	}

	if _, err := tx.ExecContext(ctx, `UPDATE account_codes SET used_at = now() WHERE id = $1`, id); err != nil {
		return err
	}
	if apply != nil {
		if err := apply(tx, target); err != nil {
			return err
		}
	}
	return tx.Commit()
}
