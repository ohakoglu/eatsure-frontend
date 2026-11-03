# EatSure frontend

Static mobile frontend. Serve with a static server; configure the API origin before `app.js` via `window.EATSURE_CONFIG = { backendBase: "https://your-api.example" }`. The backend must explicitly allow the frontend origin. The historical Render URL remains the fallback; no deployment was made.

The UI supports barcode lookup, two required label photos and an optional extra photo, previews/replacement, explicit external processing consent, full reanalysis, HTTP error/retry handling, timeout and duplicate-request protection. Evidence, source and evaluation date appear with results. Cross-contamination is presented as “Çölyak için uygun değil”, rather than falsely asserting measured gluten content.

Existing Supabase accounts can log in through the API. Access tokens are held in memory and cleared on reload/sign-out; no service-role key belongs in this repository. Contribution/appeal notes are pending review, with history and withdrawal. Configure the backend migration and scheduled retention job before enabling contributions publicly. No self-service signup or reviewer management UI is claimed.

Debug UI is hidden unless `window.EATSURE_CONFIG.enableDebug === true`; production API debug remains disabled regardless of this client option.

Browser regressions run from the sibling backend using `npm test`, a local static server, Chromium and mocked API routes. No live API or OCR calls are used by those tests.

OCR evidence-quality follow-up: weak transcription and unverified ingredient-panel warnings are shown as plain Turkish instructions, without technical codes or clinical safety percentages. This frontend follow-up accompanies the backend feature/ocr-evidence-quality-20261103 branch.

Visual-review revision: consent version `2026-11-03.3` covers direct OpenAI processing of the same photo set and, on disagreement, one more request with photos, OCR and rule explanations. Gemini is no longer part of this path. Deploy this frontend before enabling `LLM_REVIEW_ENABLED` in the backend. Visual quotes are labelled as needing confirmation and rendered as text, never HTML. Unresolved checks preserve existing hazard warnings; grounded reconciliation explains that the original decision was retained without adding a clinical guarantee. Photo timeout remains 120 seconds.

Not live enabled. Syntax and whitespace checks passed; backend non-network checks pass 89/89. Updated Chromium/HTTP regressions are pending because automatic escalation review hit the account usage limit. The former 110/110 full-suite result belongs to the previous text-review revision, not this change.
