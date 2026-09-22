package account

import (
	"html"
	"strings"

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
