# EatSure frontend

Static mobile application at https://ohakoglu.github.io/eatsure-frontend/. The three views are `#tara` (scanner), `#profil` (account) and `#admin` (review). The barcode camera stops when leaving the scanner or putting the page in the background. Open it again when returning. The web manifest supplies launch metadata. Queries require an internet connection.

Configure the API origin before `app.js` using `window.EATSURE_CONFIG = { backendBase: "https://your-api.example" }`; the production Render API is the fallback. The backend must allow the frontend origin. Load `accounts.js` after `app.js`.

## Account and review views

The profile shows verified account information and role, edits the display name, and lists the last 100 own contributions with reviewer notes and withdrawal. Reviewers/admins get a searchable queue, further-information/rejection actions, verified-label publication and a read-only daily shared-budget summary. Approval requires independently checked evidence and the backend recalculates the decision. No user-role assignment, API keys or budget-changing controls exist in the client.

Tokens stay in memory. Refresh and sign-out require a fresh login. On session expiry or revocation, private review content and open image previews are cleared. The API verifies every privileged operation. Reviewers can enlarge images without leaving the review and reload an expired link from the authorized evidence list.

An account request goes to review. Approved users receive a private single-use activation link through the configured account process. The proof is removed from the address and verified after the user presses the activation button. Keep that tab open until the password is set. If an interrupted setup cannot reuse its link, ask the issuer for a new one. The API controls whether email recovery is available.

## Product analysis

Barcode lookup and photo analysis retain two required photos, optional extra photo, previews/replacement, explicit external-processing consent, retry/timeout handling, and duplicate-request guards. Evidence and source dates are visible. Weak OCR and unverified panels produce readable conservative warnings.

Consent `2026-11-03.3` covers direct OpenAI visual evaluation and at most one recheck with photos, OCR and rule explanations. Quotes are identified as model-reported evidence requiring confirmation. Unresolved disagreements preserve existing hazards. A resolved difference retains the original decision without adding a clinical guarantee. Images and model outputs from public photo analysis are not persisted by the application.

During the pilot, the Debug / Karar ayrıntıları button is visible and its panel starts collapsed. It shows the returned decision/evidence, OCR output, visual-review metadata and complete API response without another analysis request. Keep it available until the user explicitly requests the general-public launch. At that point it can be hidden using `window.EATSURE_CONFIG.enableDebug = false`. Production-only internal API debug remains disabled; this panel uses the existing public analysis response.

## Verification

Run `npm test` from the matching backend with `EATSURE_FRONTEND_PATH` set to this checkout. Browser tests use local static serving, Chromium and mocked endpoints. The backend mobile verification guide also covers desktop WebKit and physical iPhone checks.
