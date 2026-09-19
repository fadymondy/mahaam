// Package secretbox seals small secrets at rest (integration API tokens, and later the vault)
// with AES-256-GCM, and signs short-lived values (OAuth/install state) with an HMAC derived
// from the same key.
//
// The key comes from MAHAAM_SECRET_KEY: 32 bytes, standard or URL-safe base64. A sealed value
// is "v<id>:<base64url(nonce||ciphertext)>", where <id> names the key that sealed it
// (MAHAAM_SECRET_KEY_ID, default "1"). To rotate: move the current key into
// MAHAAM_SECRET_KEY_PREVIOUS as "<id>:<base64>" (comma-separated for several), set the new
// key and a new id. Open reads any known id; Seal always uses the current key.
//
// In production (APP_ENV=production) a missing or malformed key is a boot failure. Anywhere
// else a development key is derived deterministically (from AUTH_SECRET when set) and a
// warning is logged, so a fresh checkout runs — and values sealed in dev stay readable
// across restarts.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"sync"
)

// Box holds the current key and any previous keys (by id).
type Box struct {
	current string
	keys    map[string][]byte
}

// ErrMalformed is returned by Open for input that is not a sealed value.
var ErrMalformed = errors.New("secretbox: malformed sealed value")

// New builds a Box from a current key id + key and optional previous keys. Keys must be 32 bytes.
func New(currentID string, current []byte, previous map[string][]byte) (*Box, error) {
	if currentID == "" || strings.ContainsAny(currentID, ":,") {
		return nil, fmt.Errorf("secretbox: invalid key id %q", currentID)
	}
	b := &Box{current: currentID, keys: map[string][]byte{}}
	for id, k := range previous {
		if len(k) != 32 {
			return nil, fmt.Errorf("secretbox: previous key %q must be 32 bytes, got %d", id, len(k))
		}
		b.keys[id] = k
	}
	if len(current) != 32 {
		return nil, fmt.Errorf("secretbox: key must be 32 bytes, got %d", len(current))
	}
	b.keys[currentID] = current
	return b, nil
}

// Seal encrypts plaintext with the current key.
func (b *Box) Seal(plaintext []byte) (string, error) {
	gcm, err := aead(b.keys[b.current])
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	// The key id is authenticated as additional data, so a value cannot be relabelled.
	ct := gcm.Seal(nonce, nonce, plaintext, []byte(b.current))
	return "v" + b.current + ":" + base64.RawURLEncoding.EncodeToString(ct), nil
}

// Open decrypts a value produced by Seal (with the current or a previous key).
func (b *Box) Open(sealed string) ([]byte, error) {
	if !strings.HasPrefix(sealed, "v") {
		return nil, ErrMalformed
	}
	id, body, ok := strings.Cut(sealed[1:], ":")
	if !ok {
		return nil, ErrMalformed
	}
	key, known := b.keys[id]
	if !known {
		return nil, fmt.Errorf("secretbox: unknown key id %q (add it to MAHAAM_SECRET_KEY_PREVIOUS)", id)
	}
	raw, err := base64.RawURLEncoding.DecodeString(body)
	if err != nil {
		return nil, ErrMalformed
	}
	gcm, err := aead(key)
	if err != nil {
		return nil, err
	}
	if len(raw) < gcm.NonceSize() {
		return nil, ErrMalformed
	}
	pt, err := gcm.Open(nil, raw[:gcm.NonceSize()], raw[gcm.NonceSize():], []byte(id))
	if err != nil {
		return nil, errors.New("secretbox: cannot open (wrong key or tampered value)")
	}
	return pt, nil
}

// Sign returns an HMAC-SHA256 of msg (base64url) under a subkey of the current key, for
// short-lived signed values such as an install state. Rotation invalidates outstanding
// signatures, which is fine for values that live minutes.
func (b *Box) Sign(msg []byte) string {
	m := hmac.New(sha256.New, b.macKey())
	m.Write(msg)
	return base64.RawURLEncoding.EncodeToString(m.Sum(nil))
}

// Verify checks a Sign signature in constant time.
func (b *Box) Verify(msg []byte, sig string) bool {
	want, err := base64.RawURLEncoding.DecodeString(sig)
	if err != nil {
		return false
	}
	m := hmac.New(sha256.New, b.macKey())
	m.Write(msg)
	return hmac.Equal(m.Sum(nil), want)
}

func (b *Box) macKey() []byte {
	h := sha256.Sum256(append([]byte("managy-secretbox-mac:"), b.keys[b.current]...))
	return h[:]
}

func aead(key []byte) (cipher.AEAD, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	return cipher.NewGCM(block)
}

// ---- the process-wide box -------------------------------------------------------

var (
	mu      sync.Mutex
	def     *Box
	initErr error
)

// Init loads the process-wide box from the environment. It returns an error only in
// production (APP_ENV=production) when the key is missing or invalid; elsewhere it falls back
// to a derived development key and logs a warning. Safe to call more than once.
func Init(log *slog.Logger) error {
	mu.Lock()
	defer mu.Unlock()
	if def != nil {
		return nil
	}
	b, err := FromEnv(os.Getenv)
	if err != nil {
		if strings.EqualFold(os.Getenv("APP_ENV"), "production") {
			initErr = fmt.Errorf("MAHAAM_SECRET_KEY: %w — set a 32-byte base64 key (openssl rand -base64 32) before starting in production", err)
			return initErr
		}
		seed := "managy-dev-secretbox"
		if s := os.Getenv("AUTH_SECRET"); s != "" {
			seed += ":" + s
		}
		sum := sha256.Sum256([]byte(seed))
		b, _ = New("dev", sum[:], nil)
		if log != nil {
			log.Warn("MAHAAM_SECRET_KEY is not set — using a derived DEVELOPMENT key for secrets at rest; never do this in production", "reason", err.Error())
		}
	}
	def = b
	return nil
}

// FromEnv builds a Box from MAHAAM_SECRET_KEY, MAHAAM_SECRET_KEY_ID and MAHAAM_SECRET_KEY_PREVIOUS.
// Each falls back to its pre-rebrand MANAGY_* name, so a deployment that still sets
// MANAGY_SECRET_KEY keeps opening what it sealed.
func FromEnv(getenv func(string) string) (*Box, error) {
	getenv = withLegacyEnv(getenv)
	raw := strings.TrimSpace(getenv("MAHAAM_SECRET_KEY"))
	if raw == "" {
		return nil, errors.New("not set")
	}
	key, err := decodeKey(raw)
	if err != nil {
		return nil, err
	}
	id := strings.TrimSpace(getenv("MAHAAM_SECRET_KEY_ID"))
	if id == "" {
		id = "1"
	}
	prev := map[string][]byte{}
	for _, part := range strings.Split(getenv("MAHAAM_SECRET_KEY_PREVIOUS"), ",") {
		part = strings.TrimSpace(part)
		if part == "" {
			continue
		}
		pid, pk, ok := strings.Cut(part, ":")
		if !ok {
			return nil, fmt.Errorf("MAHAAM_SECRET_KEY_PREVIOUS entries are <id>:<base64 key>")
		}
		k, err := decodeKey(pk)
		if err != nil {
			return nil, fmt.Errorf("previous key %q: %w", pid, err)
		}
		prev[strings.TrimSpace(pid)] = k
	}
	return New(id, key, prev)
}

func decodeKey(s string) ([]byte, error) {
	s = strings.TrimSpace(s)
	for _, enc := range []*base64.Encoding{base64.StdEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.RawURLEncoding} {
		if k, err := enc.DecodeString(s); err == nil {
			if len(k) != 32 {
				return nil, fmt.Errorf("decodes to %d bytes, want 32", len(k))
			}
			return k, nil
		}
	}
	return nil, errors.New("not valid base64")
}

func box() (*Box, error) {
	mu.Lock()
	b, err := def, initErr
	mu.Unlock()
	if b != nil {
		return b, nil
	}
	if err != nil {
		return nil, err
	}
	if err := Init(nil); err != nil {
		return nil, err
	}
	mu.Lock()
	defer mu.Unlock()
	return def, nil
}

// Seal encrypts with the process-wide box.
func Seal(plaintext []byte) (string, error) {
	b, err := box()
	if err != nil {
		return "", err
	}
	return b.Seal(plaintext)
}

// Open decrypts with the process-wide box.
func Open(sealed string) ([]byte, error) {
	b, err := box()
	if err != nil {
		return nil, err
	}
	return b.Open(sealed)
}

// Sign signs msg with the process-wide box ("" if the box is unavailable).
func Sign(msg []byte) string {
	b, err := box()
	if err != nil {
		return ""
	}
	return b.Sign(msg)
}

// Verify checks a Sign signature with the process-wide box.
func Verify(msg []byte, sig string) bool {
	b, err := box()
	if err != nil {
		return false
	}
	return b.Verify(msg, sig)
}

// withLegacyEnv reads MAHAAM_* first and falls back to the old MANAGY_* name (the product was
// called Managy before the rename to Mahaam).
func withLegacyEnv(getenv func(string) string) func(string) string {
	return func(name string) string {
		if v := getenv(name); strings.TrimSpace(v) != "" {
			return v
		}
		if rest, ok := strings.CutPrefix(name, "MAHAAM_"); ok {
			return getenv("MANAGY_" + rest)
		}
		return ""
	}
}
