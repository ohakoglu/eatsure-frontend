# EatSure frontend

Static mobile application at https://ohakoglu.github.io/eatsure-frontend/. The three views are `#tara` (scanner), `#profil` (account) and `#admin` (review). Hash navigation works on GitHub Pages, preserves an in-progress analysis, and stops the scanner camera when leaving that view.

Configure the API origin before `app.js` using `window.EATSURE_CONFIG = { backendBase: "https://your-api.example" }`; the production Render API is the fallback. The backend must allow the frontend origin. Load `accounts.js` after `app.js`.

## Account and review views

The profile shows verified account information and role, edits the display name, and lists the last 100 own contributions with reviewer notes and withdrawal. Reviewers/admins get a searchable queue, further-information/rejection actions, verified-label publication and a read-only daily shared-budget summary. Approval requires independently checked evidence and the backend recalculates the decision. No user-role assignment, API keys or budget-changing controls exist in the client.

Tokens stay in memory, not browser storage. Refresh/sign-out clears the application session. Session expiry, revoked access and late responses cannot leave protected information in the page. All user/model/reviewer content is rendered as text. Role labels are not an authorization boundary; the API verifies every privileged operation.

New accounts use a private single-use activation link supplied by an authorized operator. The proof is removed from the address and verified after the owner presses the activation button; the owner then chooses a password. No setup links belong in this repository. Email recovery is shown only when the backend reports a verified configuration. Production has no custom SMTP and keeps this action disabled. See backend `docs/ACCOUNTS_2026-11-05.md` for provisioning and security details. There is no public self-service signup.

## Product analysis

Barcode lookup and photo analysis retain two required photos, optional extra photo, previews/replacement, explicit external-processing consent, retry/timeout handling, and duplicate-request guards. Evidence and source dates are visible. Weak OCR and unverified panels produce readable conservative warnings.

Consent `2026-11-03.3` covers direct OpenAI visual evaluation and at most one recheck with photos, OCR and rule explanations. Quotes are identified as model-reported evidence requiring confirmation. Unresolved disagreements preserve existing hazards. A resolved difference retains the original decision without adding a clinical guarantee. Images and model outputs from public photo analysis are not persisted by the application.

During the pilot, the Debug / Karar ayrıntıları button is visible and its panel starts collapsed. It shows the returned decision/evidence, OCR output, visual-review metadata and complete API response without another analysis request. Keep it available until the user explicitly requests the general-public launch. At that point it can be hidden using `window.EATSURE_CONFIG.enableDebug = false`. Production-only internal API debug remains disabled; this panel uses the existing public analysis response.

## Verification

Run `npm test` from the sibling backend. Browser tests use local static serving, Chromium and mocked endpoints; no paid OCR/LLM calls or outgoing email. They cover scanner regression, mobile profile/admin layout, authorization, editing, withdrawal, moderation, password setup, stale response protection and camera cleanup.
