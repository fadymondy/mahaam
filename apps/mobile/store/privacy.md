# Privacy answers

These match the app as it ships:
- the privacy manifest in `app.config.ts` (`ios.privacyManifests`);
- the privacy policy (https://console.mahaam.app/en/legal/privacy);
- what the code sends: the API, the crash monitor (`src/lib/monitor.tsx`) and Report a problem.

Change all three together. The app has **no ads, no analytics SDK, no tracking and no
data sold or shared with third parties.** Data goes to Mahaam's own server (`console.mahaam.app`),
over HTTPS.

## Apple: App Privacy ("nutrition label")

**Does the app collect data?** Yes. **Used for tracking?** No, for every type.

| Data type (Apple's name) | Collected | Linked to the user | Purpose |
|---|---|---|---|
| Contact Info → Name | yes | yes | App Functionality |
| Contact Info → Email Address | yes | yes | App Functionality |
| User Content → Photos or Videos (profile photo, attachments) | yes | yes | App Functionality |
| User Content → Other User Content (issues, comments, requests, time entries) | yes | yes | App Functionality |
| Identifiers → User ID | yes | yes | App Functionality |
| Diagnostics → Crash Data (JavaScript errors, device model, OS version) | yes | yes | App Functionality |
| Diagnostics → Performance Data | yes | yes | App Functionality |
| Contact Info → Phone Number, Physical Address, Other | no | | |
| Health & Fitness, Financial Info, Location, Sensitive Info, Contacts, Browsing/Search History, Purchases, Usage Data, Audio | no | | |

Notes for the form:
- Face ID stays on the device (LocalAuthentication); nothing leaves it, so it is not declared.
- Push tokens (Device ID) are not collected until remote push ships. When it does, add Identifiers
  → Device ID, linked, for App Functionality.
- Invoices shown to customers are the workspace's own documents. The app takes no payments, so
  Financial Info is "no".

## Google Play: Data safety

- **Does the app collect or share any of the required user data types?** Yes (collects; does not share).
- **Is all of the user data encrypted in transit?** Yes.
- **Do you provide a way for users to request that their data is deleted?** Yes, in the app
  (Profile → Delete account) and at https://console.mahaam.app/en/delete-account.

| Category → type | Collected | Shared | Optional? | Purposes |
|---|---|---|---|---|
| Personal info → Name | yes | no | required | App functionality, Account management |
| Personal info → Email address | yes | no | required | App functionality, Account management |
| Personal info → User IDs | yes | no | required | App functionality, Account management |
| Photos and videos → Photos | yes | no | optional | App functionality |
| Files and docs | yes (attachments) | no | optional | App functionality |
| App activity → Other user-generated content | yes | no | required | App functionality |
| App info and performance → Crash logs | yes | no | required | App functionality |
| App info and performance → Diagnostics | yes | no | required | App functionality |
| Location, Financial info, Health, Messages, Contacts, Calendar, Audio, Web browsing, Device IDs | no | | | |

Processing is not ephemeral: accounts and content are stored until the workspace or the account is
deleted. Deleted accounts are anonymised after the 14-day grace period.
