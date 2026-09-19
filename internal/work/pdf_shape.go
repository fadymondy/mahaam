package work

import (
	"strings"
	"unicode"
)

/*
Arabic in a PDF without a shaping engine.

fpdf draws one glyph per code point, left to right, with no OpenType shaping (no GSUB joining,
no bidi). So the PDF export shapes Arabic itself, the way pure-Go report generators do:

  - shaping: every Arabic letter is replaced by its contextual presentation form (Unicode
    Arabic Presentation Forms-B, U+FE70–U+FEFF: isolated / final / initial / medial) from its
    joining neighbours, and lam + alef become the mandatory lam-alef ligature. The bundled font
    (Vazirmatn, OFL) carries those glyphs.
  - bidi: a simplified Unicode bidi pass per line. The paragraph direction is the first strong
    character's. Runs are Arabic (RTL), Latin letters/digits (LTR) and neutrals; a neutral run
    takes the direction of its neighbours when they agree and the paragraph's otherwise. The
    line is then laid out visually: RTL runs reversed (with mirrored brackets), run order
    reversed in an RTL paragraph.

Known limits (documented in the README): harakat are kept but not positioned (no GPOS), so
fully vowelled text looks rough; nested embeddings and explicit bidi controls are ignored.
Markdown export carries the logical text untouched and is the exact path for Arabic.
*/

// forms: isolated, final, initial, medial (0 = the letter has no such form).
var arabicForms = map[rune][4]rune{
	0x0621: {0xFE80, 0, 0, 0},
	0x0622: {0xFE81, 0xFE82, 0, 0},
	0x0623: {0xFE83, 0xFE84, 0, 0},
	0x0624: {0xFE85, 0xFE86, 0, 0},
	0x0625: {0xFE87, 0xFE88, 0, 0},
	0x0626: {0xFE89, 0xFE8A, 0xFE8B, 0xFE8C},
	0x0627: {0xFE8D, 0xFE8E, 0, 0},
	0x0628: {0xFE8F, 0xFE90, 0xFE91, 0xFE92},
	0x0629: {0xFE93, 0xFE94, 0, 0},
	0x062A: {0xFE95, 0xFE96, 0xFE97, 0xFE98},
	0x062B: {0xFE99, 0xFE9A, 0xFE9B, 0xFE9C},
	0x062C: {0xFE9D, 0xFE9E, 0xFE9F, 0xFEA0},
	0x062D: {0xFEA1, 0xFEA2, 0xFEA3, 0xFEA4},
	0x062E: {0xFEA5, 0xFEA6, 0xFEA7, 0xFEA8},
	0x062F: {0xFEA9, 0xFEAA, 0, 0},
	0x0630: {0xFEAB, 0xFEAC, 0, 0},
	0x0631: {0xFEAD, 0xFEAE, 0, 0},
	0x0632: {0xFEAF, 0xFEB0, 0, 0},
	0x0633: {0xFEB1, 0xFEB2, 0xFEB3, 0xFEB4},
	0x0634: {0xFEB5, 0xFEB6, 0xFEB7, 0xFEB8},
	0x0635: {0xFEB9, 0xFEBA, 0xFEBB, 0xFEBC},
	0x0636: {0xFEBD, 0xFEBE, 0xFEBF, 0xFEC0},
	0x0637: {0xFEC1, 0xFEC2, 0xFEC3, 0xFEC4},
	0x0638: {0xFEC5, 0xFEC6, 0xFEC7, 0xFEC8},
	0x0639: {0xFEC9, 0xFECA, 0xFECB, 0xFECC},
	0x063A: {0xFECD, 0xFECE, 0xFECF, 0xFED0},
	0x0640: {0x0640, 0x0640, 0x0640, 0x0640}, // tatweel joins both ways
	0x0641: {0xFED1, 0xFED2, 0xFED3, 0xFED4},
	0x0642: {0xFED5, 0xFED6, 0xFED7, 0xFED8},
	0x0643: {0xFED9, 0xFEDA, 0xFEDB, 0xFEDC},
	0x0644: {0xFEDD, 0xFEDE, 0xFEDF, 0xFEE0},
	0x0645: {0xFEE1, 0xFEE2, 0xFEE3, 0xFEE4},
	0x0646: {0xFEE5, 0xFEE6, 0xFEE7, 0xFEE8},
	0x0647: {0xFEE9, 0xFEEA, 0xFEEB, 0xFEEC},
	0x0648: {0xFEED, 0xFEEE, 0, 0},
	0x0649: {0xFEEF, 0xFEF0, 0, 0},
	0x064A: {0xFEF1, 0xFEF2, 0xFEF3, 0xFEF4},
	// Persian / Urdu letters common in names (Presentation Forms-A).
	0x067E: {0xFB56, 0xFB57, 0xFB58, 0xFB59},
	0x0686: {0xFB7A, 0xFB7B, 0xFB7C, 0xFB7D},
	0x0698: {0xFB8A, 0xFB8B, 0, 0},
	0x06A9: {0xFB8E, 0xFB8F, 0xFB90, 0xFB91},
	0x06AF: {0xFB92, 0xFB93, 0xFB94, 0xFB95},
	0x06CC: {0xFBFC, 0xFBFD, 0xFBFE, 0xFBFF},
}

// lam + alef variant → {isolated, final} ligature.
var lamAlef = map[rune][2]rune{
	0x0622: {0xFEF5, 0xFEF6},
	0x0623: {0xFEF7, 0xFEF8},
	0x0625: {0xFEF9, 0xFEFA},
	0x0627: {0xFEFB, 0xFEFC},
}

// transparent marks (harakat, superscript alef) do not break joining.
func arabicMark(r rune) bool {
	return (r >= 0x064B && r <= 0x065F) || r == 0x0670 || (r >= 0x06D6 && r <= 0x06ED)
}

func joinsNext(r rune) bool { f, ok := arabicForms[r]; return ok && f[2] != 0 }
func joinsPrev(r rune) bool { f, ok := arabicForms[r]; return ok && f[1] != 0 }

// shapeArabic returns s (logical order) with contextual presentation forms.
func shapeArabic(s string) string {
	rs := []rune(s)
	neighbour := func(i, step int) rune {
		for j := i + step; j >= 0 && j < len(rs); j += step {
			if !arabicMark(rs[j]) {
				return rs[j]
			}
		}
		return 0
	}
	var b strings.Builder
	for i := 0; i < len(rs); i++ {
		r := rs[i]
		f, ok := arabicForms[r]
		if !ok {
			b.WriteRune(r)
			continue
		}
		prev := neighbour(i, -1)
		fromPrev := joinsNext(prev) && joinsPrev(r)
		if r == 0x0644 { // lam-alef
			j := i + 1
			for j < len(rs) && arabicMark(rs[j]) {
				j++
			}
			if j < len(rs) {
				if lig, ok := lamAlef[rs[j]]; ok {
					if fromPrev {
						b.WriteRune(lig[1])
					} else {
						b.WriteRune(lig[0])
					}
					for k := i + 1; k < j; k++ {
						b.WriteRune(rs[k])
					}
					i = j
					continue
				}
			}
		}
		toNext := joinsNext(r) && joinsPrev(neighbour(i, 1))
		form := f[0]
		switch {
		case fromPrev && toNext:
			form = f[3]
		case fromPrev:
			form = f[1]
		case toNext:
			form = f[2]
		}
		if form == 0 {
			form = f[0]
		}
		b.WriteRune(form)
	}
	return b.String()
}

func isRTLRune(r rune) bool {
	return (r >= 0x0590 && r <= 0x08FF) || (r >= 0xFB1D && r <= 0xFDFF) || (r >= 0xFE70 && r <= 0xFEFF)
}

func isLTRRune(r rune) bool {
	return !isRTLRune(r) && (unicode.IsLetter(r) || unicode.IsDigit(r))
}

// HasRTL reports whether s contains right-to-left text.
func HasRTL(s string) bool {
	for _, r := range s {
		if isRTLRune(r) {
			return true
		}
	}
	return false
}

var mirror = map[rune]rune{'(': ')', ')': '(', '[': ']', ']': '[', '{': '}', '}': '{', '<': '>', '>': '<', '«': '»', '»': '«'}

// visualLine shapes and reorders one line for a left-to-right glyph renderer. rtl reports the
// paragraph direction (the caller right-aligns RTL lines).
func visualLine(s string) (out string, rtl bool) {
	if !HasRTL(s) {
		return s, false
	}
	rs := []rune(shapeArabic(s))
	for _, r := range rs {
		if isRTLRune(r) {
			rtl = true
			break
		}
		if isLTRRune(r) {
			break
		}
	}
	// direction per rune: 1 = RTL, 0 = LTR, -1 = neutral
	dir := make([]int, len(rs))
	for i, r := range rs {
		switch {
		case isRTLRune(r):
			dir[i] = 1
		case isLTRRune(r):
			dir[i] = 0
		default:
			dir[i] = -1
		}
	}
	para := 0
	if rtl {
		para = 1
	}
	for i := 0; i < len(rs); {
		if dir[i] != -1 {
			i++
			continue
		}
		j := i
		for j < len(rs) && dir[j] == -1 {
			j++
		}
		before, after := para, para
		if i > 0 {
			before = dir[i-1]
		}
		if j < len(rs) {
			after = dir[j]
		}
		d := para
		if before == after {
			d = before
		}
		for k := i; k < j; k++ {
			dir[k] = d
		}
		i = j
	}
	type run struct {
		rtl bool
		rs  []rune
	}
	var runs []run
	for i := 0; i < len(rs); {
		j := i
		for j < len(rs) && dir[j] == dir[i] {
			j++
		}
		seg := append([]rune(nil), rs[i:j]...)
		if dir[i] == 1 {
			for a, z := 0, len(seg)-1; a < z; a, z = a+1, z-1 {
				seg[a], seg[z] = seg[z], seg[a]
			}
			for k, r := range seg {
				if m, ok := mirror[r]; ok {
					seg[k] = m
				}
			}
		}
		runs = append(runs, run{dir[i] == 1, seg})
		i = j
	}
	if rtl {
		for a, z := 0, len(runs)-1; a < z; a, z = a+1, z-1 {
			runs[a], runs[z] = runs[z], runs[a]
		}
	}
	var b strings.Builder
	for _, r := range runs {
		b.WriteString(string(r.rs))
	}
	return b.String(), rtl
}
