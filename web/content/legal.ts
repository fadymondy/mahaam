// The public Terms of Service and Privacy Policy (MH-345), in English and Arabic.
//
// Written against what the code does, not what a template says a SaaS does. When behaviour
// changes (a new integration, analytics, a new client app), this file changes in the same commit,
// the same rule as apps/extension/store/PRIVACY.md, which the extension section here agrees with.
//
// REVIEWED stays false until the owner has read and approved the text. While it is false every
// page says so at the top: an unreviewed legal page presented as final is worse than none.

export const LEGAL_UPDATED = "2026-09-23"
export const LEGAL_REVIEWED = false

export type LegalDoc = "terms" | "privacy"
export const LEGAL_DOCS: LegalDoc[] = ["terms", "privacy"]

type Localized = { title: string; summary: string; body: string }

const privacyEn = `
## The short version

Mahaam keeps your team's projects, tasks, issues and time so that your team can use them. We don't sell your data, we don't show you ads, and **no analytics or tracking scripts run in Mahaam today**. You can delete your account from inside the app.

## Who is responsible

Mahaam ("we", "us") is the controller of your account data. Each **workspace** (the company or team that uses Mahaam) controls the work stored in it: its owners decide who can see it, and we process it on their behalf.

## What we collect, and why

**Your account.** Your email address and a password (stored only as a salted bcrypt hash, never in plain text). Optionally, a name, a profile picture, your language and your timezone. We use these to sign you in and to show you to your teammates.

**Your work.** What you and your team put into a workspace: projects, tasks, issues, comments, attachments, clients, invoices, time entries and reports. It's stored so the workspace can use it, and it's visible to the people the workspace's owners allow.

**Time tracking.** Timers you start and stop, and time you log by hand, with the project, task and description you chose. The desktop app notices when your computer has been idle so it can ask whether to keep that time; it reads only how long the system has been idle, never what you were doing.

**The browser extension.** It reads nothing from the pages you visit. When you choose **File an issue for this page**, it sends that page's address, its title, any text you selected, and a screenshot of the visible part of the tab, which you see first and can remove. When you choose **Log time on this page**, it sends the address, title and selection, with no screenshot. Browsing normally sends nothing.

**Issue reports and the feedback widget.** When someone reports a problem through Mahaam's "Report a problem" dialog, or through a feedback widget a workspace has put on its own website, the report can include a screenshot, the page address, the browser and screen size, and the page's recent console and network messages. A workspace that adds the widget to its site is responsible for telling its own visitors.

**Error monitoring.** A workspace can connect its own software to Mahaam to receive error reports. Those reports contain whatever that software sends, and the workspace is responsible for them.

**Notifications.** If you turn on notifications in the installed web app, we store the push subscription your browser gives us so that we can send them. On the mobile apps, we store the device's push token for the same reason. You can turn these off at any time.

**Connected services.** If a workspace connects GitHub, Jira, Linear or Google Contacts, we store the access that service grants and the data it sends (for example repository activity or imported contacts), only to provide that feature.

**AI agents.** If you create an access token for an AI agent (MCP), the agent can do what that token allows and nothing more. We record the agent's activity in the workspace like anyone else's.

**Security and operation.** When you use Mahaam we record when you were last active, and for changes in a workspace we record who did what and when (the activity log). Our servers keep technical logs, which include IP addresses, to keep the service running and secure.

## Cookies

Mahaam uses only the cookies it needs to work: \`togo_session\` (keeps you signed in; HttpOnly), \`togo_csrf\` (protects forms against cross-site requests) and \`NEXT_LOCALE\` (remembers your language). There are no advertising or tracking cookies.

## Analytics

None today. If we add product analytics, it will measure *how* Mahaam is used (for example, how many tasks are created), never *what* is in it. Task titles, project names, comments, file names and page addresses will not be sent. We'll update this page before it ships.

## Who else handles your data

We use a small number of providers to run Mahaam: the infrastructure that hosts our servers, a network provider that protects them, an email provider for the mail we send, and Polar to process payments (we never see your full card number). Push notifications travel through your browser's or phone's push service (Google, Apple or Mozilla). The integrations you choose to connect receive what they need to work.

## How long we keep it

Your account and your work are kept for as long as your account and your workspaces exist. Codes we email you (to reset a password or confirm an address) expire after 10 minutes.

When you **delete your account**, you're signed out everywhere at once and every token and connected agent stops working. After **14 days** the account is permanently anonymised: your email, name, picture and password are removed, and so are your memberships, your inbox and your connections. Work you did in a shared workspace (comments, time entries on an invoice, and so on) stays with that workspace, attributed to a deleted user, because it's part of other people's records. Signing in again within the 14 days cancels the deletion.

When a workspace is deleted, its work is deleted with it.

## Your rights

You can see and correct your profile in the app, change your email address or password, and delete your account. For anything else, including a copy of your data or a question about how it's used, write to us at the address below. If you are in a region with data protection law, you also have the right to complain to your local authority.

## Children

Mahaam is a work tool and is not meant for children under 16.

## Changes

If we change this policy in a way that matters, we'll tell you in the app or by email before it takes effect.

## Contact

support@mahaam.app
`

const termsEn = `
## Agreement

These terms are an agreement between you and Mahaam for your use of Mahaam: the web app, the mobile apps, the desktop app, the browser extension, the API and the MCP server. By creating an account or using Mahaam you accept them. If you use Mahaam for a company, you accept them on its behalf and confirm that you're allowed to.

## Your account

Keep your password and your access tokens safe. You're responsible for what's done with your account and your tokens, including by AI agents you connect. Tell us at once if you think someone else has access.

## Workspaces

A workspace belongs to its owners. They decide who is a member, what each member can see and do, and what happens to the workspace's data. If you're invited to a workspace, the work you do there belongs to the workspace.

## Your content

You keep the rights to what you put into Mahaam. You give us permission to store, process and display it only as needed to provide Mahaam to you and your workspace. We don't claim it, sell it or use it to train AI models.

You're responsible for having the right to upload what you upload, and for the personal data about other people that your workspace stores, such as your clients' contact details.

## Acceptable use

Don't use Mahaam to break the law, to store or send malware, to harass anyone, to get into accounts or data that aren't yours, or to overload or probe the service beyond normal use. Automated access through the API and MCP is welcome within the limits of your plan and its rate limits.

## Plans and payment

Some features and quotas depend on the workspace's plan. Paid plans are billed in advance through our payment provider, and usage beyond a plan's quota is billed as shown on the plan page. Fees are not refundable except where the law requires. If a payment fails, we may limit the workspace after telling its owners.

## Availability and changes

We work to keep Mahaam available and your data safe, but we can't promise that it will never be interrupted. We may change or remove features; if a change takes away something you rely on, we'll tell you in advance where we can.

## Ending

You can stop using Mahaam and delete your account at any time. We may suspend or close an account that breaks these terms, and we'll tell you why unless the law or safety prevents it.

## Liability

Mahaam is provided "as is". To the extent the law allows, we aren't liable for indirect or consequential losses, and our total liability is limited to what you paid us in the 12 months before the claim.

## Changes to these terms

If we change these terms in a way that matters, we'll tell you before the change takes effect. Continuing to use Mahaam after that means you accept the new terms.

## Contact

support@mahaam.app
`

const privacyAr = `
## باختصار

يحتفظ مهام بمشاريع فريقك ومهامه وبلاغاته ووقته كي يستخدمها فريقك. لا نبيع بياناتك، ولا نعرض عليك إعلانات، و**لا تعمل في مهام اليوم أي أدوات تحليلات أو تتبّع**. ويمكنك حذف حسابك من داخل التطبيق.

## من المسؤول

مهام ("نحن") هو المتحكّم في بيانات حسابك. أما **مساحة العمل** (الشركة أو الفريق الذي يستخدم مهام) فتتحكّم في العمل المخزّن فيها: مالكوها يقرّرون من يراه، ونحن نعالجه نيابةً عنهم.

## ما الذي نجمعه ولماذا

**حسابك.** بريدك الإلكتروني وكلمة مرور (تُخزَّن فقط بصيغة bcrypt مُملَّحة، ولا تُخزَّن كنصّ أبداً). واختيارياً: اسم وصورة شخصية ولغتك ومنطقتك الزمنية. نستخدمها لتسجيل دخولك ولإظهارك لزملائك.

**عملك.** ما تضعه أنت وفريقك في مساحة العمل: المشاريع والمهام والبلاغات والتعليقات والمرفقات والعملاء والفواتير وسجلات الوقت والتقارير. يُخزَّن لتستخدمه مساحة العمل، ويراه من يسمح لهم مالكوها.

**تتبّع الوقت.** المؤقّتات التي تبدؤها وتوقفها والوقت الذي تسجّله يدوياً، مع المشروع والمهمة والوصف الذي اخترته. يلاحظ تطبيق سطح المكتب خمول جهازك ليسألك هل تُبقي ذلك الوقت، ويقرأ فقط مدة خمول النظام، لا ما كنت تفعله.

**إضافة المتصفح.** لا تقرأ شيئاً من الصفحات التي تزورها. عندما تختار **الإبلاغ عن مشكلة في هذه الصفحة** ترسل عنوان الصفحة وعنوانها وأي نص حدّدته ولقطة للجزء الظاهر من التبويب، تراها أولاً ويمكنك إزالتها. وعندما تختار **تسجيل وقت على هذه الصفحة** ترسل العنوان والعنوان والنص المحدّد دون لقطة. التصفّح العادي لا يرسل شيئاً.

**البلاغات وأداة الملاحظات.** عندما يبلّغ شخص عن مشكلة عبر نافذة "الإبلاغ عن مشكلة" في مهام، أو عبر أداة ملاحظات وضعتها مساحة عمل على موقعها، قد يتضمّن البلاغ لقطة شاشة وعنوان الصفحة والمتصفّح وحجم الشاشة ورسائل وحدة التحكّم والشبكة الأخيرة للصفحة. ومساحة العمل التي تضيف الأداة إلى موقعها مسؤولة عن إبلاغ زوّارها.

**مراقبة الأخطاء.** يمكن لمساحة العمل ربط برمجياتها بمهام لتلقّي تقارير الأخطاء. تحتوي هذه التقارير ما ترسله تلك البرمجيات، ومساحة العمل مسؤولة عنها.

**الإشعارات.** إن فعّلت الإشعارات في تطبيق الويب المثبّت نخزّن اشتراك الإشعارات الذي يعطينا إياه متصفّحك لنرسلها. وفي تطبيقات الجوال نخزّن رمز الإشعارات للجهاز للسبب نفسه. يمكنك إيقافها في أي وقت.

**الخدمات المتصلة.** إن ربطت مساحة عمل GitHub أو Jira أو Linear أو جهات اتصال Google، نخزّن الصلاحية التي تمنحها تلك الخدمة والبيانات التي ترسلها (مثل نشاط المستودعات أو جهات الاتصال المستوردة)، فقط لتقديم تلك الميزة.

**وكلاء الذكاء الاصطناعي.** إن أنشأت رمز وصول لوكيل ذكاء اصطناعي (MCP) فيستطيع الوكيل فعل ما يسمح به ذلك الرمز فقط. ونسجّل نشاطه في مساحة العمل كنشاط أي شخص آخر.

**الأمان والتشغيل.** عند استخدامك مهام نسجّل آخر نشاط لك، ونسجّل لكل تغيير في مساحة العمل من فعل ماذا ومتى (سجل النشاط). وتحتفظ خوادمنا بسجلات تقنية تشمل عناوين IP لإبقاء الخدمة عاملة وآمنة.

## ملفات تعريف الارتباط

يستخدم مهام فقط ملفات تعريف الارتباط اللازمة لعمله: \`togo_session\` (يبقيك مسجّل الدخول؛ HttpOnly) و\`togo_csrf\` (يحمي النماذج من الطلبات عبر المواقع) و\`NEXT_LOCALE\` (يتذكّر لغتك). لا توجد ملفات إعلانية أو للتتبّع.

## التحليلات

لا شيء اليوم. إن أضفنا تحليلات للمنتج فستقيس *كيف* يُستخدم مهام (مثلاً عدد المهام المُنشأة)، ولا تقيس أبداً *ما* بداخله. لن تُرسَل عناوين المهام وأسماء المشاريع والتعليقات وأسماء الملفات وعناوين الصفحات. وسنحدّث هذه الصفحة قبل ذلك.

## من يتعامل أيضاً مع بياناتك

نستخدم عدداً قليلاً من المزوّدين لتشغيل مهام: البنية التي تستضيف خوادمنا، ومزوّد شبكة يحميها، ومزوّد بريد للرسائل التي نرسلها، وPolar لمعالجة المدفوعات (لا نرى رقم بطاقتك كاملاً أبداً). تمرّ الإشعارات عبر خدمة الإشعارات في متصفّحك أو هاتفك (Google أو Apple أو Mozilla). وتتلقّى الخدمات التي تختار ربطها ما تحتاجه لتعمل.

## مدة الاحتفاظ

يُحتفظ بحسابك وعملك ما دام حسابك ومساحات عملك موجودة. تنتهي صلاحية الرموز التي نرسلها إلى بريدك (لإعادة تعيين كلمة المرور أو تأكيد البريد) بعد 10 دقائق.

عندما **تحذف حسابك** يُسجَّل خروجك من كل مكان فوراً ويتوقّف كل رمز وكل وكيل متصل. وبعد **14 يوماً** يصبح الحساب مجهول الهوية نهائياً: تُزال بريدك واسمك وصورتك وكلمة مرورك، وكذلك عضوياتك وصندوق إشعاراتك واتصالاتك. أما عملك في مساحة عمل مشتركة (التعليقات، وسجلات الوقت في فاتورة، وغير ذلك) فيبقى لتلك المساحة منسوباً إلى مستخدم محذوف، لأنه جزء من سجلات أشخاص آخرين. تسجيل الدخول مجدداً خلال الأيام الأربعة عشر يلغي الحذف.

وعند حذف مساحة عمل يُحذف عملها معها.

## حقوقك

يمكنك رؤية ملفك الشخصي وتصحيحه في التطبيق، وتغيير بريدك أو كلمة مرورك، وحذف حسابك. ولأي شيء آخر، بما في ذلك نسخة من بياناتك أو سؤال عن كيفية استخدامها، راسلنا على العنوان أدناه. وإن كنت في منطقة لديها قانون لحماية البيانات فلك أيضاً حق تقديم شكوى إلى الجهة المختصة لديك.

## الأطفال

مهام أداة عمل وليس مخصّصاً للأطفال دون 16 عاماً.

## التغييرات

إن غيّرنا هذه السياسة تغييراً مهماً فسنخبرك في التطبيق أو بالبريد قبل سريانه.

## التواصل

support@mahaam.app
`

const termsAr = `
## الاتفاق

هذه الشروط اتفاق بينك وبين مهام لاستخدامك مهام: تطبيق الويب وتطبيقات الجوال وتطبيق سطح المكتب وإضافة المتصفح وواجهة البرمجة وخادم MCP. بإنشائك حساباً أو استخدامك مهام فأنت تقبلها. وإن كنت تستخدم مهام لصالح شركة فأنت تقبلها نيابةً عنها وتؤكّد أنك مخوّل بذلك.

## حسابك

احفظ كلمة مرورك ورموز الوصول الخاصة بك. أنت مسؤول عمّا يُفعل بحسابك ورموزك، بما في ذلك من وكلاء الذكاء الاصطناعي الذين تربطهم. أخبرنا فوراً إن ظننت أن أحداً غيرك وصل إليه.

## مساحات العمل

مساحة العمل ملك لمالكيها. هم يقرّرون من العضو، وما يراه كل عضو ويفعله، وما يحدث لبيانات المساحة. وإن دُعيت إلى مساحة عمل فالعمل الذي تنجزه فيها ملك لها.

## محتواك

تحتفظ بحقوق ما تضعه في مهام. وتمنحنا الإذن بتخزينه ومعالجته وعرضه بالقدر اللازم فقط لتقديم مهام لك ولمساحة عملك. لا ندّعي ملكيته ولا نبيعه ولا نستخدمه لتدريب نماذج الذكاء الاصطناعي.

أنت مسؤول عن امتلاك حق رفع ما ترفعه، وعن البيانات الشخصية لأشخاص آخرين التي تخزّنها مساحة عملك، مثل بيانات الاتصال بعملائك.

## الاستخدام المقبول

لا تستخدم مهام لمخالفة القانون، أو لتخزين برمجيات خبيثة أو إرسالها، أو لمضايقة أحد، أو للوصول إلى حسابات أو بيانات ليست لك، أو لإثقال الخدمة أو فحصها بما يتجاوز الاستخدام العادي. الوصول الآلي عبر واجهة البرمجة وMCP مرحّب به ضمن حدود خطتك وحدود معدّل الطلبات.

## الخطط والدفع

تعتمد بعض الميزات والحصص على خطة مساحة العمل. تُدفع الخطط المدفوعة مقدّماً عبر مزوّد الدفع لدينا، ويُحتسب الاستخدام الزائد عن حصة الخطة كما يظهر في صفحة الخطط. الرسوم غير قابلة للاسترداد إلا حيث يفرض القانون ذلك. وإن فشل الدفع فقد نقيّد مساحة العمل بعد إبلاغ مالكيها.

## التوفّر والتغييرات

نعمل على إبقاء مهام متاحاً وبياناتك آمنة، لكن لا نستطيع أن نعد بألا ينقطع أبداً. قد نغيّر الميزات أو نزيلها؛ وإن أزال تغييرٌ شيئاً تعتمد عليه فسنخبرك مسبقاً حيثما أمكن.

## الإنهاء

يمكنك التوقّف عن استخدام مهام وحذف حسابك في أي وقت. وقد نعلّق أو نغلق حساباً يخالف هذه الشروط، وسنخبرك بالسبب ما لم يمنع ذلك القانون أو السلامة.

## المسؤولية

يُقدَّم مهام "كما هو". وبالقدر الذي يسمح به القانون، لسنا مسؤولين عن الخسائر غير المباشرة أو التبعية، وتقتصر مسؤوليتنا الإجمالية على ما دفعته لنا في الأشهر الاثني عشر السابقة للمطالبة.

## تغيير هذه الشروط

إن غيّرنا هذه الشروط تغييراً مهماً فسنخبرك قبل سريانه. واستمرارك في استخدام مهام بعد ذلك يعني قبولك للشروط الجديدة.

## التواصل

support@mahaam.app
`

export const LEGAL: Record<LegalDoc, Record<"en" | "ar", Localized>> = {
  privacy: {
    en: { title: "Privacy Policy", summary: "What Mahaam collects, why, who else handles it, and how to delete it.", body: privacyEn },
    ar: { title: "سياسة الخصوصية", summary: "ما يجمعه مهام ولماذا، ومن يتعامل معه أيضاً، وكيف تحذفه.", body: privacyAr },
  },
  terms: {
    en: { title: "Terms of Service", summary: "The agreement for using Mahaam on the web, mobile, desktop and in the browser.", body: termsEn },
    ar: { title: "شروط الخدمة", summary: "اتفاق استخدام مهام على الويب والجوال وسطح المكتب والمتصفح.", body: termsAr },
  },
}
