# EatSure frontend

Static mobile frontend. Serve with a static server; configure the API origin before `app.js` via `window.EATSURE_CONFIG = { backendBase: "https://your-api.example" }`. The backend must explicitly allow the frontend origin. The historical Render URL remains the fallback; no deployment was made.

The UI supports barcode lookup, two required label photos and an optional extra photo, previews/replacement, explicit external processing consent, full reanalysis, HTTP error/retry handling, timeout and duplicate-request protection. Evidence, source and evaluation date appear with results. Cross-contamination is presented as “Çölyak için uygun değil”, rather than falsely asserting measured gluten content.

Existing Supabase accounts can log in through the API. Access tokens are held in memory and cleared on reload/sign-out; no service-role key belongs in this repository. Contribution/appeal notes are pending review, with history and withdrawal. Configure the backend migration and scheduled retention job before enabling contributions publicly. No self-service signup or reviewer management UI is claimed.

Debug UI is hidden unless `window.EATSURE_CONFIG.enableDebug === true`; production API debug remains disabled regardless of this client option.

Browser regressions run from the sibling backend using `npm test`, a local static server, Chromium and mocked API routes. No live API or OCR calls are used by those tests.

OCR evidence-quality follow-up: weak transcription and unverified ingredient-panel warnings are shown as plain Turkish instructions, without technical codes or clinical safety percentages. This frontend follow-up accompanies the backend feature/ocr-evidence-quality-20261103 branch.

Independent-review follow-up: external processing consent also covers extracted label text sent to OpenAI and Google Gemini when the backend review feature is enabled. Requests include consent version `2026-11-03.2`; deploy this frontend before enabling reviews so old OCR-only consent cannot silently authorize new processing. Review concerns and unavailable checks use plain Turkish instructions. Source quotes are rendered as text, never HTML; no model score or clinical guarantee is displayed. Photo requests allow up to 120 seconds for OCR plus bounded independent checks/arbitration. Backend model review is opt-in and has not been enabled live. The combined local backend/browser suite passes 110/110 tests with mocked providers.
