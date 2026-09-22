package account

import (
	"html"
	"strings"
	"time"

	"github.com/togo-framework/mail"
)

// Mail for account events, in English or Arabic. Plain wording, the code set large and apart,
// and a line for whoever did NOT ask. Most of these reach someone who expected them, but the
// ones that matter reach someone who didn't.

type mailText struct {
	subject, lead, codeNote, notYou, changedSubject, changedBody, changedNotYou string
}

var resetText = map[string]mailText{
	"en": {
		subject:        "Your Mahaam password reset code",
		lead:           "Use this code to set a new password for your Mahaam account:",
		codeNote:       "It works for 10 minutes, once.",
		notYou:         "If you didn't ask for this, ignore this email. Your password has not changed, and nobody can change it without this code.",
		changedSubject: "Your Mahaam password was changed",
		changedBody:    "The password for your Mahaam account was just changed with a reset code, and every device that was signed in has been signed out.",
		changedNotYou:  "If this wasn't you, someone can read this inbox. Secure your email account first, then reset your Mahaam password again.",
	},
	"ar": {
		subject:        "رمز إعادة تعيين كلمة مرور مهام",
		lead:           "استخدم هذا الرمز لتعيين كلمة مرور جديدة لحسابك في مهام:",
		codeNote:       "صالح لمدة 10 دقائق، ولمرة واحدة.",
		notYou:         "إن لم تطلب ذلك فتجاهل هذه الرسالة. لم تتغير كلمة مرورك، ولا يمكن لأحد تغييرها دون هذا الرمز.",
		changedSubject: "تم تغيير كلمة مرور مهام",
		changedBody:    "تم للتو تغيير كلمة مرور حسابك في مهام باستخدام رمز إعادة التعيين، وتم تسجيل الخروج من جميع الأجهزة.",
		changedNotYou:  "إن لم تكن أنت، فهناك من يستطيع قراءة بريدك. أمّن حساب بريدك أولاً، ثم أعد تعيين كلمة مرور مهام مجدداً.",
	},
}

func textFor(locale string) (mailText, string) {
	if t, ok := resetText[locale]; ok {
		return t, locale
	}
	return resetText["en"], "en"
}

func resetMail(to, code, locale string) mail.Message {
	t, loc := textFor(locale)
	text := t.lead + "\n\n    " + code + "\n\n" + t.codeNote + "\n\n" + t.notYou + "\n"
	body := `<p>` + html.EscapeString(t.lead) + `</p>` +
		// dir=ltr: digits in an RTL paragraph are fine, but a spaced code reads backwards to some
		// renderers. The code is always left to right.
		`<p dir="ltr" style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,monospace">` + html.EscapeString(code) + `</p>` +
		`<p>` + html.EscapeString(t.codeNote) + `</p>` +
		`<p style="color:#666">` + html.EscapeString(t.notYou) + `</p>`
	return mail.Message{To: []string{to}, Subject: t.subject, Text: text, HTML: page(loc, body)}
}

func changedMail(to, locale string) mail.Message {
	t, loc := textFor(locale)
	text := t.changedBody + "\n\n" + t.changedNotYou + "\n"
	body := `<p>` + html.EscapeString(t.changedBody) + `</p><p style="color:#666">` + html.EscapeString(t.changedNotYou) + `</p>`
	return mail.Message{To: []string{to}, Subject: t.changedSubject, Text: text, HTML: page(loc, body)}
}

func page(locale, body string) string {
	dir := "ltr"
	if strings.HasPrefix(locale, "ar") {
		dir = "rtl"
	}
	return `<!doctype html><html lang="` + locale + `" dir="` + dir + `"><body style="font-family:system-ui,sans-serif;line-height:1.5;color:#111">` +
		body + `</body></html>`
}

type changeText struct {
	subject, lead, codeNote, notYou, doneSubject, done, doneNotYou string
}

var emailChangeText = map[string]changeText{
	"en": {
		subject:     "Confirm your new Mahaam email address",
		lead:        "Enter this code in Mahaam to move your account to this address:",
		codeNote:    "It works for 10 minutes, once.",
		notYou:      "If you didn't ask for this, ignore this email and nothing will change.",
		doneSubject: "Your Mahaam email address was changed",
		done:        "Your Mahaam account now signs in with %s instead of this address.",
		doneNotYou:  "If this wasn't you, reply to this email or contact support straight away. Password reset codes now go to the new address.",
	},
	"ar": {
		subject:     "أكّد بريدك الإلكتروني الجديد في مهام",
		lead:        "أدخل هذا الرمز في مهام لنقل حسابك إلى هذا البريد:",
		codeNote:    "صالح لمدة 10 دقائق، ولمرة واحدة.",
		notYou:      "إن لم تطلب ذلك فتجاهل هذه الرسالة ولن يتغير شيء.",
		doneSubject: "تم تغيير بريدك الإلكتروني في مهام",
		done:        "أصبح حسابك في مهام يسجّل الدخول بالبريد %s بدلاً من هذا البريد.",
		doneNotYou:  "إن لم تكن أنت، فردّ على هذه الرسالة أو تواصل مع الدعم فوراً. رموز إعادة تعيين كلمة المرور تُرسل الآن إلى البريد الجديد.",
	},
}

func changeTextFor(locale string) (changeText, string) {
	if t, ok := emailChangeText[locale]; ok {
		return t, locale
	}
	return emailChangeText["en"], "en"
}

func emailChangeMail(to, code, locale string) mail.Message {
	t, loc := changeTextFor(locale)
	text := t.lead + "\n\n    " + code + "\n\n" + t.codeNote + "\n\n" + t.notYou + "\n"
	body := `<p>` + html.EscapeString(t.lead) + `</p>` +
		`<p dir="ltr" style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,monospace">` + html.EscapeString(code) + `</p>` +
		`<p>` + html.EscapeString(t.codeNote) + `</p><p style="color:#666">` + html.EscapeString(t.notYou) + `</p>`
	return mail.Message{To: []string{to}, Subject: t.subject, Text: text, HTML: page(loc, body)}
}

func emailChangedMail(to, next, locale string) mail.Message {
	t, loc := changeTextFor(locale)
	done := strings.Replace(t.done, "%s", next, 1)
	text := done + "\n\n" + t.doneNotYou + "\n"
	body := `<p>` + strings.Replace(html.EscapeString(t.done), "%s", `<bdi dir="ltr">`+html.EscapeString(next)+`</bdi>`, 1) + `</p>` +
		`<p style="color:#666">` + html.EscapeString(t.doneNotYou) + `</p>`
	return mail.Message{To: []string{to}, Subject: t.doneSubject, Text: text, HTML: page(loc, body)}
}

type deletionText struct {
	subject, body, undo, cancelledSubject, cancelled string
}

var deletionTexts = map[string]deletionText{
	"en": {
		subject:          "Your Mahaam account will be deleted",
		body:             "You asked to delete your Mahaam account. It has been signed out everywhere, and it will be permanently deleted on %s.",
		undo:             "Changed your mind? Sign in before then and the deletion is cancelled. If you didn't ask for this, sign in now and change your password.",
		cancelledSubject: "Your Mahaam account will not be deleted",
		cancelled:        "You signed in again, so the deletion of your Mahaam account has been cancelled. Nothing was removed.",
	},
	"ar": {
		subject:          "سيتم حذف حسابك في مهام",
		body:             "طلبت حذف حسابك في مهام. تم تسجيل الخروج من كل الأجهزة، وسيُحذف الحساب نهائياً في %s.",
		undo:             "غيّرت رأيك؟ سجّل الدخول قبل ذلك وسيُلغى الحذف. إن لم تطلب ذلك، فسجّل الدخول الآن وغيّر كلمة مرورك.",
		cancelledSubject: "لن يتم حذف حسابك في مهام",
		cancelled:        "سجّلت الدخول مجدداً، لذلك أُلغي حذف حسابك في مهام. لم يُحذف أي شيء.",
	},
}

func deletionTextFor(locale string) (deletionText, string) {
	if t, ok := deletionTexts[locale]; ok {
		return t, locale
	}
	return deletionTexts["en"], "en"
}

func deletionScheduledMail(to string, purge time.Time, locale string) mail.Message {
	t, loc := deletionTextFor(locale)
	// A date with no time or zone: "on 7 October" is what a person plans around, and the reaper
	// runs hourly anyway.
	day := purge.UTC().Format("2 January 2006")
	body := strings.Replace(t.body, "%s", day, 1)
	return mail.Message{To: []string{to}, Subject: t.subject, Text: body + "\n\n" + t.undo + "\n",
		HTML: page(loc, `<p>`+strings.Replace(html.EscapeString(t.body), "%s", `<bdi dir="ltr">`+html.EscapeString(day)+`</bdi>`, 1)+`</p><p>`+html.EscapeString(t.undo)+`</p>`)}
}

func deletionCancelledMail(to, locale string) mail.Message {
	t, loc := deletionTextFor(locale)
	return mail.Message{To: []string{to}, Subject: t.cancelledSubject, Text: t.cancelled + "\n",
		HTML: page(loc, `<p>`+html.EscapeString(t.cancelled)+`</p>`)}
}

var verifyTexts = map[string][3]string{
	"en": {"Confirm your email for Mahaam", "Enter this code in Mahaam to confirm this is your address:", "It works for 10 minutes. If you didn't create a Mahaam account, ignore this email."},
	"ar": {"أكّد بريدك الإلكتروني في مهام", "أدخل هذا الرمز في مهام لتأكيد أن هذا بريدك:", "صالح لمدة 10 دقائق. إن لم تنشئ حساباً في مهام فتجاهل هذه الرسالة."},
}

func verifyMail(to, code, locale string) mail.Message {
	t, ok := verifyTexts[locale]
	if !ok {
		locale, t = "en", verifyTexts["en"]
	}
	text := t[1] + "\n\n    " + code + "\n\n" + t[2] + "\n"
	body := `<p>` + html.EscapeString(t[1]) + `</p>` +
		`<p dir="ltr" style="font-size:28px;font-weight:600;letter-spacing:6px;font-family:ui-monospace,monospace">` + html.EscapeString(code) + `</p>` +
		`<p style="color:#666">` + html.EscapeString(t[2]) + `</p>`
	return mail.Message{To: []string{to}, Subject: t[0], Text: text, HTML: page(locale, body)}
}
