package account

import (
	"bytes"
	"encoding/base64"
	"errors"
	"image"
	_ "image/gif" // registered decoders: what a phone or a browser hands over
	"image/jpeg"
	_ "image/png"
	"io"
)

// AvatarSize is the side of the stored square. Twice the largest size the UI draws, for a sharp
// picture on a high-density screen.
const AvatarSize = 256

// maxAvatarPixels bounds what the decoder is allowed to allocate. The header is read first, so a
// 1 KB PNG that claims to be 60,000 × 60,000 is refused before it can ask for 14 GB of RAM.
const maxAvatarPixels = 40_000_000

var (
	ErrAvatarFormat = errors.New("the picture must be a JPEG, PNG or GIF")
	ErrAvatarSize   = errors.New("the picture is too large")
)

// AvatarDataURL turns an uploaded picture into what is stored: a centred square, scaled down to
// AvatarSize, flattened onto white and re-encoded as a JPEG data: URL.
//
// Re-encoding is the point, not a side effect. What is stored is only pixels this code produced,
// so nothing else the upload carried survives, whether that's a camera's EXIF block with the GPS
// position of someone's home, or a file that is a valid image and also something else.
func AvatarDataURL(r io.Reader) (string, error) {
	raw, err := io.ReadAll(io.LimitReader(r, 10<<20+1))
	if err != nil {
		return "", err
	}
	if len(raw) > 10<<20 {
		return "", ErrAvatarSize
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(raw))
	if err != nil {
		return "", ErrAvatarFormat
	}
	if cfg.Width <= 0 || cfg.Height <= 0 || cfg.Width*cfg.Height > maxAvatarPixels {
		return "", ErrAvatarSize
	}
	src, _, err := image.Decode(bytes.NewReader(raw))
	if err != nil {
		return "", ErrAvatarFormat
	}
	var out bytes.Buffer
	if err := jpeg.Encode(&out, squareThumb(src, AvatarSize), &jpeg.Options{Quality: 85}); err != nil {
		return "", err
	}
	return "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(out.Bytes()), nil
}

// squareThumb crops the centred square and box-averages it down to size (never up). Averaging
// every source pixel into its target cell is slower than sampling but doesn't alias: a sampled
// downscale of a photo with fine detail comes out as moiré.
func squareThumb(src image.Image, size int) *image.RGBA {
	b := src.Bounds()
	side := b.Dx()
	if b.Dy() < side {
		side = b.Dy()
	}
	x0, y0 := b.Min.X+(b.Dx()-side)/2, b.Min.Y+(b.Dy()-side)/2
	if side < size {
		size = side
	}
	sums := make([]uint64, size*size*4)
	counts := make([]uint64, size*size)
	for y := 0; y < side; y++ {
		row := (y * size / side) * size
		for x := 0; x < side; x++ {
			i := row + x*size/side
			r, g, bl, a := src.At(x0+x, y0+y).RGBA() // 16-bit, alpha-premultiplied
			sums[i*4] += uint64(r)
			sums[i*4+1] += uint64(g)
			sums[i*4+2] += uint64(bl)
			sums[i*4+3] += uint64(a)
			counts[i]++
		}
	}
	dst := image.NewRGBA(image.Rect(0, 0, size, size))
	for i, n := range counts {
		if n == 0 {
			n = 1
		}
		a := sums[i*4+3] / n
		// Over white: premultiplied colour plus white for whatever alpha is missing. JPEG has no
		// alpha, and a transparent PNG left as-is turns black.
		for c := 0; c < 3; c++ {
			v := sums[i*4+c]/n + (0xffff - a)
			if v > 0xffff {
				v = 0xffff
			}
			dst.Pix[i*4+c] = uint8(v >> 8)
		}
		dst.Pix[i*4+3] = 0xff
	}
	return dst
}
