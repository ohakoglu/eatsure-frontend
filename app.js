const DEFAULT_BACKEND_BASE = "https://eatsure-backend-4dkh.onrender.com";

const startSection = document.getElementById("startSection");
const manualBarcodeBtn = document.getElementById("manualBarcodeBtn");
const noBarcodeBtn = document.getElementById("noBarcodeBtn");
const manualBarcodePanel = document.getElementById("manualBarcodePanel");
const barcodeInputEl = document.getElementById("barcodeInput");
const scanProductBtn = document.getElementById("scanProductBtn");
const startCameraBtn = document.getElementById("startCameraBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");
const readerEl = document.getElementById("reader");

const photoSection = document.getElementById("photoSection");
const photoStepTitle = document.getElementById("photoStepTitle");
const photoStepText = document.getElementById("photoStepText");
const frontFileInput = document.getElementById("frontFileInput");
const ingredientsFileInput = document.getElementById("ingredientsFileInput");
const extraFileInput = document.getElementById("extraFileInput");
const choosePhotoBtn = document.getElementById("choosePhotoBtn");
const extraChoicePanel = document.getElementById("extraChoicePanel");
const addExtraPhotoBtn = document.getElementById("addExtraPhotoBtn");
const skipExtraPhotoBtn = document.getElementById("skipExtraPhotoBtn");
const photoProgress = document.getElementById("photoProgress");

const statusSection = document.getElementById("statusSection");
const userStatusEl = document.getElementById("userStatus");
const resultSection = document.getElementById("resultSection");
const userResultEl = document.getElementById("userResult");
const toggleDebugBtn = document.getElementById("toggleDebugBtn");
const debugPanel = document.getElementById("debugPanel");
const backendResultEl = document.getElementById("backendResult");
const ocrTextEl = document.getElementById("ocrText");
const analyzeTextBtn = document.getElementById("analyzeTextBtn");

let barcodeCodeReader = null;
let barcodeScanControls = null;
let cameraRunning = false;
let cameraGeneration = 0;
let barcodeDetected = false;
let productLookupInFlight = false;
let photoAnalysisInFlight = false;
let accessToken = null;
let lastRetry = null;
const previewUrls = new Map();
let productLookupSlowTimer = null;

let currentPhotoStep = null;
let photoFiles = {
  front: null,
  ingredients: null,
  extra: null
};
let currentContributionContext = null;
let contributionAttempt = null;
const contributionPhotoFiles = { front_label: null, ingredients_panel: null, extra: null };
const contributionStagedMedia = { front_label: null, ingredients_panel: null, extra: null };
const contributionPreviewUrls = new Map();
const CONTRIBUTION_PHOTO_CONSENT_VERSION = "2026-11-09.1";

const PHOTO_STEPS = {
  front: {
    title: "Ön yüz fotoğrafı",
    text: "Ürünün ön yüzünü çek. Bu fotoğraf ürün adı ve marka için kullanılır.",
    input: frontFileInput
  },
  ingredients: {
    title: "Şimdi içindekiler fotoğrafı",
    text: "İçindekiler bölümünü net ve yakın çek. Karar için ana kaynak budur.",
    input: ingredientsFileInput
  },
  extra: {
    title: "Ek bilgi fotoğrafı",
    text: "Alerjen, uyarı, sertifika veya ek içerik yüzü varsa fotoğrafını ekle.",
    input: extraFileInput
  },
  extraChoice: {
    title: "Eklemek istediğin başka fotoğraf var mı?",
    text: "Alerjen, uyarı veya sertifika yüzü varsa ekleyebilirsin. Yoksa sonucu gösterelim."
  }
};

const LEVEL_UI = {
  certified: {
    title: "Geçerli resmî glutensiz sertifika doğrulandı",
    color: "#dcfce7"
  },
  declared_gf_with_ingredients: {
    title: "Üretici glutensiz beyanı",
    color: "#ecfccb"
  },
  declared_gf_no_ingredients: {
    title: "Üretici glutensiz beyanı var, içerik bilgisi eksik",
    color: "#fef3c7"
  },
  gluten_present: {
    title: "Gluten riski bulundu",
    color: "#fee2e2"
  },
  declaration_conflict: {
    title: "Çelişkili bilgi",
    color: "#ffedd5"
  },
  ingredients_safe_no_claim: {
    title: "Okunan içerikte açık gluten riski görülmedi",
    color: "#fef3c7"
  },
  insufficient_data: {
    title: "Glutensizliği doğrulamak için veri yetersiz",
    color: "#f3f4f6"
  },
  certification_suspended: {
    title: "Sertifika geçersiz",
    color: "#ffedd5"
  }
};

function getBaseUrl() {
  let savedBase;
  try { savedBase = window.localStorage?.getItem("EATSURE_BACKEND_BASE"); }
  catch { /* The browser may disable local storage. */ }
  const configuredBase = window.EATSURE_CONFIG?.backendBase || savedBase || DEFAULT_BACKEND_BASE;
  return String(configuredBase).replace(/\/+$/, "");
}


async function requestJson(path, options = {}, timeoutMs = 70000) {
  const controller = new AbortController();
  const callerSignal = options.signal;
  const cancel = () => controller.abort();
  if (callerSignal?.aborted) cancel();
  else callerSignal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const base = getBaseUrl();
    const authenticated = new Headers(options.headers).has('Authorization');
    if (authenticated) {
      const target = new URL(base);
      const loopback = host => ['localhost', '127.0.0.1', '[::1]'].includes(host);
      const local = loopback(location.hostname) && loopback(target.hostname) && ['http:', 'https:'].includes(target.protocol);
      if (!local && base !== DEFAULT_BACKEND_BASE) throw new Error('Oturum için güvenilir API adresi gerekli.');
    }
    let response;
    try {
      response = await fetch(`${base}${path}`, { ...options, signal: controller.signal, ...(authenticated ? { redirect: 'error' } : {}) });
    } catch (error) {
      if (error.name !== 'TypeError' || controller.signal.aborted) throw error;
      throw new Error('Bağlantı kurulamadı. İnterneti kontrol edip tekrar deneyin.');
    }
    let data = {};
    if (response.status !== 204) {
      try { data = await response.json(); } catch (error) {
        if (controller.signal.aborted) throw error;
        throw new Error("Sunucu yanıtı okunamadı. Lütfen tekrar deneyin.");
      }
    }
    if (controller.signal.aborted) throw new DOMException('Request cancelled', 'AbortError');
    if (!response.ok) {
      if (response.status === 401 && options.headers?.Authorization === `Bearer ${accessToken}`) { clearAccountSession(); }
      const failure = new Error(data.message || (response.status === 429 ? "Çok fazla istek. Biraz sonra tekrar deneyin." : "İstek tamamlanamadı. Lütfen tekrar deneyin."));
      if (data.error === "SOURCE_UNAVAILABLE") failure.payload = data;
      failure.status = response.status; failure.code = data.error; throw failure;
    }
    return data;
  } catch (error) {
    if (callerSignal?.aborted) throw Object.assign(new Error('Analiz durduruldu.'), { code: 'PHOTO_CANCELLED' });
    if (controller.signal.aborted) throw new Error("İstek zaman aşımına uğradı. Tekrar deneyebilirsiniz.");
    throw error;
  } finally {
    clearTimeout(timer);
    callerSignal?.removeEventListener('abort', cancel);
  }
}

let activePhotoRequest = null;
let photoAttempt = null;

function ensureQuerySession() {
  if (accessToken && !passwordSetup) return true;
  location.hash = '#profil';
  document.getElementById('sessionStatus').textContent = 'Sorgu yapmak için hesabınıza giriş yapın.';
  return false;
}
function showRetry(action) {
  lastRetry = action;
  document.getElementById("retryBtn").classList.remove("hidden");
}
function hideRetry() { document.getElementById("retryBtn").classList.add("hidden"); lastRetry = null; }

function clearContributionPhotos(discardStaged = true) {
  for (const [role, url] of contributionPreviewUrls) URL.revokeObjectURL(url);
  contributionPreviewUrls.clear();
  for (const role of Object.keys(contributionPhotoFiles)) {
    if (discardStaged && contributionStagedMedia[role] && accessToken) accountRequest(`/contributions/media/${encodeURIComponent(contributionStagedMedia[role])}`, { method: "DELETE" }).catch(() => {});
    contributionPhotoFiles[role] = null; contributionStagedMedia[role] = null;
  }
  for (const id of ["contributionFrontPhoto", "contributionIngredientsPhoto", "contributionExtraPhoto"]) document.getElementById(id).value = "";
  document.getElementById("moderationPhotoConsent").checked = false;
  document.getElementById("contributionPhotoPreviews").replaceChildren();
}

function updateContributionKindFields() {
  const kind = document.getElementById("contributionKind").value;
  const groups = {
    new_product: ["contributionNewProductFields", ["contributionProductName", "contributionBrand"]],
    label_correction: ["contributionCorrectionFields", ["contributionCurrentValue", "contributionProposedValue"]],
    decision_dispute: ["contributionDisputeFields", ["contributionErrorType"]]
  };
  for (const [key, [groupId, inputIds]] of Object.entries(groups)) {
    const active = kind === key;
    document.getElementById(groupId).classList.toggle("hidden", !active);
    for (const inputId of inputIds) {
      const input = document.getElementById(inputId);
      input.disabled = !active;
      input.required = active && inputId !== "contributionErrorType";
    }
  }
  document.getElementById("contributionFrontPhoto").required = kind === "new_product" && !contributionStagedMedia.front_label && !contributionPhotoFiles.front_label;
  document.getElementById("contributionIngredientsPhoto").required = kind === "new_product" && !contributionStagedMedia.ingredients_panel && !contributionPhotoFiles.ingredients_panel;
  document.getElementById("moderationPhotoConsent").required = Object.values(contributionStagedMedia).some(Boolean) || Object.values(contributionPhotoFiles).some(Boolean);
}

const CONTRIBUTION_PHOTO_INPUTS = [
  ["front_label", "contributionFrontPhoto", "Ürün ön yüzü"],
  ["ingredients_panel", "contributionIngredientsPhoto", "İçindekiler / alerjen yüzü"],
  ["extra", "contributionExtraPhoto", "Ek fotoğraf"]
];

function renderContributionPhotoPreviews() {
  const container = document.getElementById("contributionPhotoPreviews");
  container.replaceChildren();
  for (const [role, inputId, label] of CONTRIBUTION_PHOTO_INPUTS) {
    const file = contributionPhotoFiles[role];
    if (!file) continue;
    const card = document.createElement("div"); card.className = "contribution-photo-card";
    const image = document.createElement("img"); image.src = contributionPreviewUrls.get(role); image.alt = `${label} önizleme`;
    const name = document.createElement("span"); name.textContent = `${label} · ${Math.ceil(file.size / 1024)} KB`;
    const replace = document.createElement("button"); replace.type = "button"; replace.className = "btn btn-secondary btn-small"; replace.textContent = "Fotoğrafı değiştir";
    replace.addEventListener("click", () => document.getElementById(inputId).click());
    const remove = document.createElement("button"); remove.type = "button"; remove.className = "btn btn-secondary btn-small"; remove.textContent = "Kaldır";
    remove.addEventListener("click", () => clearContributionPhoto(role, inputId));
    card.append(image, name, replace, remove); container.append(card);
  }
}

function clearContributionPhoto(role, inputId) {
  const stagedId = contributionStagedMedia[role];
  if (stagedId && accessToken) accountRequest(`/contributions/media/${encodeURIComponent(stagedId)}`, { method: "DELETE" }).catch(() => {});
  if (contributionPreviewUrls.has(role)) URL.revokeObjectURL(contributionPreviewUrls.get(role));
  contributionPreviewUrls.delete(role); contributionPhotoFiles[role] = null; contributionStagedMedia[role] = null;
  document.getElementById(inputId).value = "";
  renderContributionPhotoPreviews(); updateContributionKindFields();
}

function setBackendResult(data) {
  const trace = document.getElementById("decisionTrace");
  if (typeof data === "string") {
    if (currentContributionContext) clearContributionPhotos();
    currentContributionContext = null;
    contributionAttempt = null;
    document.getElementById("contributionSection").classList.add("hidden");
    backendResultEl.textContent = data;
    trace.textContent = data;
  } else {
    const context = data?.meta?.contributionContext;
    const nextContext = context && typeof context.token === "string" && typeof context.barcode === "string" ? context : null;
    if (currentContributionContext?.token !== nextContext?.token) clearContributionPhotos();
    currentContributionContext = nextContext;
    contributionAttempt = null;
    const target = document.getElementById("contributionContextLabel");
    if (target) target.textContent = currentContributionContext
      ? `Katkı bu sonucun ${currentContributionContext.barcode} barkoduna bağlanacak.`
      : "Bu sonuç için sunucuya bağlı katkı bağlamı yok. Yeni bir barkod taraması başlatın.";
    const debugData = data && typeof data === "object" ? { ...data } : data;
    if (debugData?.meta?.contributionContext?.token) {
      debugData.meta = { ...debugData.meta, contributionContext: Object.fromEntries(Object.entries(debugData.meta.contributionContext).filter(([key]) => key !== "token")) };
    }
    backendResultEl.textContent = JSON.stringify(debugData, null, 2);
    trace.textContent = data?.decision ? JSON.stringify({
      "Veri kaynağı": data.meta?.source || (data.meta?.openFoodFactsAvailable ? "OpenFoodFacts" : null),
      "Ürün kaynağı sorgusu ve tekrarlar": data.meta?.sourceLookup || null,
      "Son karar ve gerekçe": data.decision,
      "Kural motorunun bulguları ve kanıtları": data.analysis || null,
      "Kararda kullanılan fotoğraf rolleri": data.meta?.rolePolicy || null,
      "OCR ve etiket kanıtı kalitesi": data.meta?.evidenceQuality || null,
      "Bağımsız görsel kontrol": data.meta?.independentReview || null,
      "Açıklanabilir API karar izi": data.debug || null,
      "OFF topluluk etiketleri": data.analysis?.communityClaims || null,
      "Kalite ve okunabilirlik": data.debug?.evidenceQuality || data.meta?.evidenceQuality || null,
      "Metin bölüm sınırları": data.debug?.parsedSections?.diagnostics || null,
      "Sertifika kaynağı ve kapsam kontrolü": data.debug?.certificateCheck || null,
      "Sonucu belirleyen bulgular": data.debug?.decisionBasis || null,
      "Dil kapsamı ve yorumlanan alanlar": data.analysis?.language || null,
      "Barkod kimliği kontrolü": data.meta?.barcodeIdentity || data.debug?.barcodeIdentity || null,
      "Resmî sertifika kaydı": data.meta?.certificationsApplied || null,
      "Sertifika kontrol durumu": data.meta?.certificateCheck || null,
      "Kullanılan kural sürümleri": data.meta?.ruleVersions || data.debug?.ruleVersions || null,
      "Bölüm ayrıştırma tanısı": data.parsedSections?.diagnostics || data.debug?.parsedSections?.diagnostics || null
    }, null, 2) : JSON.stringify(data, null, 2);
  }
}

function setUserMessage(title, message, color = "#f3f4f6", options = {}) {
  if (!options.keepResult) {
    resultSection.classList.add("hidden");
    userResultEl.replaceChildren();
  }
  statusSection.classList.remove("hidden");
  userStatusEl.classList.toggle("is-loading", !!options.loading);
  userStatusEl.style.background = color;
  userStatusEl.replaceChildren();

  const titleEl = document.createElement("h3");
  titleEl.textContent = title;

  const messageEl = document.createElement("p");
  messageEl.textContent = message;

  userStatusEl.append(titleEl, messageEl);
  document.getElementById('scanAnnouncement').textContent = `${title}. ${message}`;
}

function setProductLookupBusy(isBusy) {
  productLookupInFlight = isBusy;
  startCameraBtn.disabled = isBusy;
  manualBarcodeBtn.disabled = isBusy;
  scanProductBtn.disabled = isBusy;
  barcodeInputEl.disabled = isBusy;
}

function clearProductLookupSlowTimer() {
  if (productLookupSlowTimer) {
    clearTimeout(productLookupSlowTimer);
    productLookupSlowTimer = null;
  }
}

function getProductIdentity(data) {
  const identity =
    data?.productIdentity && typeof data.productIdentity === "object"
      ? data.productIdentity
      : null;

  const name =
    data?.name ||
    data?.productName ||
    data?.product_name ||
    identity?.name ||
    data?.product?.product_name ||
    null;

  const brand =
    data?.brand ||
    data?.brands ||
    identity?.brand ||
    data?.product?.brands ||
    null;

  const barcode =
    data?.barcode ||
    identity?.barcode ||
    barcodeInputEl.value ||
    null;

  return {
    name: name || "Ürün adı bulunamadı",
    brand: brand || "Marka bulunamadı",
    barcode: barcode || "Barkod bulunamadı",
    source: identity?.source || data?.meta?.source || "unknown"
  };
}

function formatProductIdentitySource(source) {
  if (source === "off" || source === "openfoodfacts_scan") return "OFF";
  if (source === "front_ocr") return "OCR";
  if (source === "database_cache") return "Cache";
  if (source === "database_stale_fallback") return "Cache";
  if (source === "unknown") return "Bilinmiyor";
  return String(source || "Bilinmiyor");
}

function getFrontLogoDetection(data) {
  const detection = data?.frontSignals?.logoDetection;

  if (!detection || typeof detection !== "object") {
    return {
      logos: [],
      warning: "Bu logo bilgisi gluten kararı için kullanılmamıştır."
    };
  }

  return {
    logos: Array.isArray(detection.logos) ? detection.logos : [],
    warning:
      detection.warning ||
      "Bu logo bilgisi gluten kararı için kullanılmamıştır."
  };
}

function formatLogoScore(score) {
  if (typeof score !== "number") return "güven değeri yok";
  return `yaklaşık güven: ${Math.round(score * 100)}%`;
}

function buildLogoDetectionElement(data) {
  const detection = getFrontLogoDetection(data);
  const wrapperEl = document.createElement("div");
  wrapperEl.className = "logo-detection";

  const titleEl = document.createElement("h4");
  titleEl.textContent = "Algılanan logolar";
  wrapperEl.appendChild(titleEl);

  if (detection.logos.length === 0) {
    const emptyEl = document.createElement("p");
    emptyEl.textContent = "Logo algılanmadı.";
    wrapperEl.appendChild(emptyEl);
  } else {
    const listEl = document.createElement("ul");

    for (const logo of detection.logos) {
      const itemEl = document.createElement("li");
      const description = logo?.description || "Açıklama yok";
      itemEl.textContent = `${description} (${formatLogoScore(logo?.score)})`;
      listEl.appendChild(itemEl);
    }

    wrapperEl.appendChild(listEl);
  }

  const warningEl = document.createElement("p");
  warningEl.className = "logo-detection-warning";
  warningEl.textContent = detection.warning;
  wrapperEl.appendChild(warningEl);

  return wrapperEl;
}

const evidenceNames = { package_photo: 'Paket fotoğrafı', manual_label_text: 'Elle girilen etiket',
  off_community: 'Open Food Facts topluluk kaydı', manufacturer_document: 'Üretici belgesi',
  official_certificate: 'Resmî sertifika', legacy_unknown: 'Önceki kayıt, kaynak türü bilinmiyor' };

function evidenceDate(value, dayOnly = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  const date = new Date(value);
  return dayOnly ? date.toLocaleDateString('tr-TR', { timeZone: 'UTC' }) : date.toLocaleString('tr-TR');
}

function renderSourceProvenance(container, data) {
  const add = (parent, tag, text) => {
    const node = document.createElement(tag); node.textContent = text; parent.appendChild(node); return node;
  };
  const provenance = data.meta?.provenance;
  const sources = Array.isArray(provenance?.sources) ? provenance.sources : [];
  add(container, 'p', sources.length ? 'Kullanılan kaynaklar' : 'Kaynak türü doğrulanamadı');
  if (sources.length) {
    const list = document.createElement('ul'); container.appendChild(list);
    for (const source of sources) {
      const uses = { identity: 'ürün bilgisi', risk: 'risk uyarısı', decision: 'karar kanıtı' };
      const details = [[source.observedAt, 'Gözlem tarihi', true], [source.labelDate, 'Etiket veya belge tarihi', true],
        [source.reviewedAt, 'İnsan incelemesi', false], [source.receivedAt, 'EatSure’a iletilme', false],
        [source.sourceUpdatedAt, 'Topluluk kaydının güncellenmesi', false], [source.checkedAt, 'Kaynağın kontrolü', false],
        [source.validFrom, 'Sertifika başlangıcı', true], [source.validUntil, 'Sertifika geçerlilik sonu', true]]
        .map(([value, label, day]) => { const date = evidenceDate(value, day); return date ? `${label}: ${date}` : null; }).filter(Boolean);
      add(list, 'li', [evidenceNames[source.kind] || evidenceNames.legacy_unknown, uses[source.use], ...details].filter(Boolean).join(' · '));
    }
  }
  const calculated = evidenceDate(provenance?.calculatedAt || data.decision?.ui?.sourceDate);
  if (calculated) add(container, 'p', `Kararın hesaplanması: ${calculated}`);
  const certificate = data.meta?.certificateCheck;
  if (certificate && certificate.state !== 'verified' && certificate.status !== 'matched_current_official_snapshot') {
    add(container, 'p', certificate.state === 'expired' ? 'Resmî sertifikanın süresi dolmuş.' : 'Resmî sertifika doğrulanamadı.');
  }
}

function renderUserResult(data) {
  statusSection.classList.add("hidden");
  resultSection.classList.remove("hidden");

  const level = data?.decision?.level || "insufficient_data";
  const ui = data.decision?.warnings?.includes("product_not_found")
    ? { title: "Ürün bulunamadı", color: "#f3f4f6" }
    : LEVEL_UI[level] || LEVEL_UI.insufficient_data;
  const reason = level === 'ingredients_safe_no_claim'
    ? 'Okunabilen içerik üzerinden değerlendirme yapıldı. Glutensizliği doğrulamak için ambalajı veya üretici bilgisini kontrol edin.'
    : data?.decision?.reason || "";
  const productIdentity = getProductIdentity(data);

  userResultEl.classList.remove("empty-state");
  userResultEl.style.background = ui.color;
  userResultEl.replaceChildren();

  const identityEl = document.createElement("div");
  identityEl.className = "product-identity";

  const identityRows = [
    ["Marka", productIdentity.brand],
    ["Ürün adı", productIdentity.name],
    ["Barkod", productIdentity.barcode],
    ["Kaynak", formatProductIdentitySource(productIdentity.source)]
  ];

  for (const [label, value] of identityRows) {
    const rowEl = document.createElement("p");
    const labelEl = document.createElement("span");
    labelEl.textContent = `${label}: `;
    const valueEl = document.createElement("strong");
    valueEl.textContent = value;
    rowEl.append(labelEl, valueEl);
    identityEl.appendChild(rowEl);
  }

  const titleEl = document.createElement("h3");
  titleEl.textContent = ui.title;

  const reasonEl = document.createElement("p");
  reasonEl.textContent = reason;

  userResultEl.append(identityEl, titleEl, reasonEl, buildLogoDetectionElement(data));
  const evidenceEl = document.createElement("ul");
  for (const evidence of data.analysis?.evidence || []) {
    const item = document.createElement("li");
    item.textContent = `${evidence.section}: ${evidence.matchedText}`;
    evidenceEl.appendChild(item);
  }
  if (evidenceEl.childElementCount) userResultEl.appendChild(evidenceEl);
  renderSourceProvenance(userResultEl, data);
  const messages = new Set();
  for (const warning of data.decision?.warnings || []) {
    const warningEl = document.createElement("p");
    const qualityWarnings = {
      product_not_found: "Ürün kaynağında bu barkod için kayıt yok. Etiket fotoğraflarıyla devam edebilirsiniz.",
      source_unavailable_using_previous: "Güncel ürün kaynağı doğrulanamadı. Önceki risk uyarısı korunuyor; yeniden doğrulama gerekiyor.",
      possible_package_change: 'Paket bilgileri değişmiş olabilir. Etiket yeniden incelenmeli.',
      product_identity_unverified: 'Ambalajın barkodunu kontrol edin ve aynı ürünün ön yüzü ile içindekiler bölümünü yeniden çekin.',
      pending_review: 'Bu sonuca itiraz inceleniyor. Güncel ambalajı veya üretici bilgisini kontrol edin.',
      review_status_unavailable: 'İnceleme durumu şu anda kontrol edilemiyor. Biraz sonra yeniden deneyin.',
      identity_unverified: 'Aynı paketin ön yüzünü ve içindekiler bölümünü yeniden çekin.',
      cross_contamination: 'Çapraz bulaş uyarısı var. Ambalajdaki “eser miktarda” bölümünü kontrol edin.',
      cross_contamination_conflict: 'Glutensiz beyanı ile çapraz bulaş uyarısı çelişiyor. Üreticiden doğrulama isteyin.',
      off_allergen_gluten_conflict: 'Topluluk kaydında gluten alerjeni bildiriliyor. Paketin alerjen bölümünü kontrol edin.',
      negative_claim_conflict: 'Etiketteki beyanlar çelişiyor. Üreticiden doğrulama isteyin.',
      cert_conflict_cross_contamination: 'Sertifika bilgisi ile çapraz bulaş uyarısı çelişiyor. Güncel paketi ve üretici bilgisini kontrol edin.',
      ocr_confidence_unavailable: "Metnin bazı bölümlerinde okuma güveni ölçülemiyor. Sonucu etiketle karşılaştırın.",
      ocr_confidence_low: "Bazı kelimeler güvenilir okunamadı. Etiketi net ve yakın çekerek yeniden deneyin.",
      ingredients_photo_unverified: "İçindekiler fotoğrafındaki içerik listesi doğrulanamadı. Bu yüzü yeniden çekin.",
      language_context_uncertain: "Etiket ifadesinin neyi anlattığı veya beyanın kesinliği belirsiz. Net etiket ya da üretici doğrulaması gerekiyor.",
      independent_review_unavailable: "Ek görsel kontrol tamamlanamadı. Mevcut risk uyarılarını dikkate alın; daha sonra yeniden deneyin.",
      independent_review_required: "Fotoğraf ve etiket değerlendirmesi arasındaki bulgular çözülemedi. Mevcut risk uyarılarını dikkate alın; üreticiden doğrulama veya uzman incelemesi gerekiyor."
    };
    const message = qualityWarnings[warning] || (warning.includes("oat") ? "Yulaf bulundu. Glutensiz üretim ve bulaş riski ayrıca doğrulanmalıdır." : "Güncel ambalajdaki içindekiler ve alerjen bilgisini kontrol edin.");
    if (messages.has(message)) continue;
    messages.add(message);
    warningEl.textContent = message;
    userResultEl.appendChild(warningEl);
  }
  const reviewEvidence = data.meta?.independentReview?.evidence;
  if (Array.isArray(reviewEvidence) && reviewEvidence.length) {
    const heading = document.createElement("p");
    heading.textContent = "Görsel kontrolün bildirdiği, doğrulama gerektiren etiket metni:";
    userResultEl.appendChild(heading);
    const roles = { front: "Ön yüz", ingredients: "İçindekiler", extra: "Ek fotoğraf" };
    for (const item of reviewEvidence.slice(0, 8)) {
      if (!roles[item.role] || typeof item.quote !== "string") continue;
      const quote = document.createElement("p");
      quote.textContent = `${roles[item.role]}: ${item.quote}`;
      userResultEl.appendChild(quote);
    }
  }
  if (data.meta?.independentReview?.status === "resolved_by_evidence") {
    const resolution = document.createElement("p");
    resolution.textContent = "İlk okumalar arasındaki fark, fotoğraf ve etiket gerekçesi yeniden incelenerek giderildi. Etiket değerlendirmesi korundu; bu kontrol glutensiz olduğuna dair ek bir garanti değildir.";
    userResultEl.appendChild(resolution);
  }
  document.getElementById("contributionSection").classList.toggle("hidden", !currentContributionContext);
  document.getElementById('scanAnnouncement').textContent = `${ui.title}. ${reason}`;
}

function isInsufficientResult(data) {
  return !data?.decision || data.decision.level === "insufficient_data";
}

function showManualBarcode() {
  manualBarcodePanel.classList.remove("hidden");
  barcodeInputEl.focus();
}

function hidePhotoInputs() {
  frontFileInput.classList.add("hidden");
  ingredientsFileInput.classList.add("hidden");
  extraFileInput.classList.add("hidden");
}

function updatePhotoProgress() {
  const items = [
    ["Ön yüz", photoFiles.front],
    ["İçindekiler", photoFiles.ingredients],
    ["Ek fotoğraf", photoFiles.extra]
  ];

  photoProgress.replaceChildren();

  for (const [label, file] of items) {
    const item = document.createElement("div");
    item.className = "progress-item";
    const text = document.createElement("span");
    text.textContent = `${file ? "Tamam" : "Bekliyor"} - ${label}`;
    item.appendChild(text);
    const role = items.findIndex(entry => entry[0] === label);
    const roleName = ["front", "ingredients", "extra"][role];
    if (file) {
      const preview = document.createElement("img");
      preview.src = previewUrls.get(roleName);
      preview.alt = `${label} önizleme`;
      preview.style.cssText = "display:block;max-width:180px;max-height:160px";
      item.appendChild(preview);
      const replace = document.createElement("button");
      replace.type = "button";
      replace.textContent = "Değiştir";
      replace.disabled = photoAnalysisInFlight;
      replace.addEventListener("click", () => { PHOTO_STEPS[roleName].input.value = ""; PHOTO_STEPS[roleName].input.click(); });
      item.appendChild(replace);
    }
    photoProgress.appendChild(item);
  }
}

function showPhotoStep(step) {
  currentPhotoStep = step;
  const config = PHOTO_STEPS[step];

  photoSection.classList.remove("hidden");
  photoStepTitle.textContent = config.title;
  photoStepText.textContent = config.text;

  hidePhotoInputs();
  extraChoicePanel.classList.add("hidden");

  if (config.input) {
    choosePhotoBtn.classList.remove("hidden");
  } else {
    choosePhotoBtn.classList.add("hidden");
  }

  if (step === "extraChoice") {
    extraChoicePanel.classList.remove("hidden");
  }

  updatePhotoProgress();
  photoSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function resetPhotoSelection() {
  for (const url of previewUrls.values()) URL.revokeObjectURL(url);
  previewUrls.clear();
  photoFiles = { front: null, ingredients: null, extra: null };
  photoAttempt = null;
  frontFileInput.value = "";
  ingredientsFileInput.value = "";
  extraFileInput.value = "";
  photoProgress.replaceChildren();
}

function startPhotoFlow() {
  if (photoAnalysisInFlight) return;
  resetPhotoSelection();
  setUserMessage("Etiket fotoğrafı gerekiyor", "Seni adım adım yönlendireceğiz.", "#f3f4f6");
  showPhotoStep("front");
}

function normalizeBarcodeText(value) {
  return String(value || "").replace(/\D/g, "").trim();
}

function isLikelyBarcode(value) {
  const cleaned = normalizeBarcodeText(value);
  return cleaned.length >= 8 && cleaned.length <= 14;
}

function getZxing() {
  return window.ZXingBrowser || window.ZXing || null;
}

function getBarcodeFormats(zxing) {
  const format = zxing?.BarcodeFormat || {};

  return [
    format.EAN_13,
    format.EAN_8,
    format.UPC_A,
    format.UPC_E,
    format.CODE_128,
    format.CODE_39,
    format.ITF
  ].filter(Boolean);
}

function createZxingReader(zxing) {
  const formats = getBarcodeFormats(zxing);

  if (zxing?.DecodeHintType) {
    const hints = new Map();
    hints.set(zxing.DecodeHintType.POSSIBLE_FORMATS, formats);
    hints.set(zxing.DecodeHintType.TRY_HARDER, true);
    return new zxing.BrowserMultiFormatReader(hints, 200);
  }

  const reader = new zxing.BrowserMultiFormatReader();

  if ("possibleFormats" in reader && formats.length > 0) {
    reader.possibleFormats = formats;
  }

  if ("timeBetweenDecodingAttempts" in reader) {
    reader.timeBetweenDecodingAttempts = 150;
  }

  return reader;
}

function createBarcodeVideoElement() {
  readerEl.replaceChildren();

  const shellEl = document.createElement("div");
  shellEl.className = "scanner-shell";

  const videoEl = document.createElement("video");
  videoEl.setAttribute("playsinline", "true");
  videoEl.setAttribute("muted", "true");
  videoEl.autoplay = true;
  videoEl.muted = true;
  videoEl.className = "scanner-video";

  const overlayEl = document.createElement("div");
  overlayEl.className = "scanner-overlay";

  const frameEl = document.createElement("div");
  frameEl.className = "scanner-frame";

  overlayEl.appendChild(frameEl);
  shellEl.append(videoEl, overlayEl);
  readerEl.appendChild(shellEl);
  return videoEl;
}

function logBarcodeVideoTrack(videoEl, source) {
  const track = videoEl?.srcObject?.getVideoTracks?.()[0];

  if (!track) {
    console.log("Barkod kamera track bulunamadı:", source);
    return;
  }

  console.log("Barkod kamera ayarları:", source, track.getSettings?.());

  if (typeof track.getCapabilities === "function") {
    console.log("Barkod kamera capabilities:", source, track.getCapabilities());
  }
}

async function startZxingWithFallback(reader, videoEl, callback, generation) {
  const constraints = {
    video: {
      facingMode: { ideal: "environment" },
      width: { ideal: 1280 },
      height: { ideal: 720 }
    },
    audio: false
  };

  if (typeof reader.decodeFromConstraints === "function") {
    try {
      const controls = await reader.decodeFromConstraints(
        constraints,
        videoEl,
        callback
      );
      logBarcodeVideoTrack(videoEl, "decodeFromConstraints");
      return controls;
    } catch (err) {
      stopVideoTracks(videoEl);
      if (generation !== cameraGeneration || ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(getBarcodeErrorName(err))) throw err;
      console.log("decodeFromConstraints başarısız, eski kamera yöntemi deneniyor:", err?.message || err);
    }
  }

  const controls = await reader.decodeFromVideoDevice(null, videoEl, callback);
  logBarcodeVideoTrack(videoEl, "decodeFromVideoDevice fallback");
  return controls;
}

function getBarcodeErrorName(error) {
  return error?.name || error?.constructor?.name || "";
}

function shouldIgnoreBarcodeError(error) {
  const name = getBarcodeErrorName(error);
  return (
    name === "NotFoundException" ||
    name === "ChecksumException" ||
    name === "FormatException"
  );
}

function stopVideoTracks(videoEl = readerEl.querySelector("video")) {
  const stream = videoEl?.srcObject;

  if (stream && typeof stream.getTracks === "function") {
    for (const track of stream.getTracks()) {
      try {
        track.stop();
      } catch {}
    }
  }
}

async function stopCameraScan() {
  cameraGeneration++;
  if (!cameraRunning && !barcodeCodeReader && !barcodeScanControls) {
    return;
  }

  try {
    if (barcodeScanControls && typeof barcodeScanControls.stop === "function") {
      barcodeScanControls.stop();
    }

    if (barcodeCodeReader && typeof barcodeCodeReader.reset === "function") {
      barcodeCodeReader.reset();
    }
  } catch (err) {
    console.log("Kamera kapatma hatası:", err?.message || err);
  }

  stopVideoTracks();
  cameraRunning = false;
  barcodeDetected = false;
  barcodeCodeReader = null;
  barcodeScanControls = null;
  readerEl.replaceChildren();
  stopCameraBtn.classList.add("hidden");
}

async function handleDetectedBarcode(rawText) {
  if (barcodeDetected) return false;

  const cleanedBarcode = normalizeBarcodeText(rawText);

  if (!isLikelyBarcode(cleanedBarcode)) {
    console.log("Barkod benzeri olmayan okuma:", rawText);
    return false;
  }

  barcodeDetected = true;
  barcodeInputEl.value = cleanedBarcode;
  await stopCameraScan();
  await scanProduct();

  return true;
}

async function startCameraScan() {
  if (cameraRunning) {
    setUserMessage("Kamera açık", "Barkodu kameraya yaklaştır.", "#f3f4f6");
    return;
  }

  const zxing = getZxing();

  if (!zxing?.BrowserMultiFormatReader) {
    setUserMessage("Kamera hazır değil", "İnternet bağlantısını kontrol edin veya barkodu elle girin.", "#fee2e2");
    showManualBarcode();
    return;
  }

  const generation = ++cameraGeneration;
  let videoEl;
  try {
    cameraRunning = true;
    barcodeDetected = false;
    stopCameraBtn.classList.remove("hidden");
    setUserMessage("Barkod taranıyor", "Barkodu net ve iyi ışıkta kameraya göster.", "#f3f4f6");

    barcodeCodeReader = createZxingReader(zxing);
    videoEl = createBarcodeVideoElement();

    const callback = async (result, error) => {
      if (barcodeDetected || generation !== cameraGeneration) return;

      if (result) {
        const rawText =
          typeof result.getText === "function"
            ? result.getText()
            : result.text || String(result || "");

        await handleDetectedBarcode(rawText);
        return;
      }

      if (error && !shouldIgnoreBarcodeError(error)) {
        console.log("Barkod okuma denemesi:", error?.message || error);
      }
    };

    const controls = await startZxingWithFallback(
      barcodeCodeReader,
      videoEl,
      callback,
      generation
    );
    if (generation !== cameraGeneration) {
      controls?.stop?.();
      stopVideoTracks(videoEl);
      return;
    }
    barcodeScanControls = controls;
  } catch (e) {
    if (generation !== cameraGeneration) { if (videoEl) stopVideoTracks(videoEl); return; }
    const denied = ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(getBarcodeErrorName(e));
    await stopCameraScan();
    setUserMessage("Kamera açılamadı", denied
      ? "Barkodu elle girin veya tarayıcının bu site için kamera iznini açıp tekrar deneyin."
      : "Kamerayı kullanan diğer sekmeleri kapatıp tekrar deneyin veya barkodu elle girin.", "#fee2e2");
    showManualBarcode();
  }
}

async function scanProduct() {
  if (!ensureQuerySession()) return;
  if (productLookupInFlight || photoAnalysisInFlight) {
    return;
  }

  const barcode = (barcodeInputEl.value || "").trim();

  if (!/^\d{8,14}$/.test(barcode)) {
    setUserMessage("Barkod gerekli", "Barkodu gir ya da barkodsuz fotoğraf akışını başlat.", "#fef3c7");
    showManualBarcode();
    return;
  }

  const session = accountGeneration;
  hideRetry();
  setProductLookupBusy(true);
  await stopCameraScan();
  setUserMessage(
    `Barkod okundu: ${barcode}`,
    "Ürün veritabanında aranıyor...",
    "#f3f4f6",
    { loading: true }
  );

  productLookupSlowTimer = setTimeout(() => {
    setUserMessage(
      `Barkod okundu: ${barcode}`,
      "OpenFoodFacts kontrol ediliyor veya sunucu uyanıyor olabilir. Lütfen bekleyin...",
      "#f3f4f6",
      { loading: true }
    );
  }, 3500);

  try {
    setBackendResult("Barkod analizi sürüyor; henüz yeni bir sonuç yok.");
    const data = await accountRequest(`/scan/${encodeURIComponent(barcode)}`, {}, 35000);
    if (session !== accountGeneration) return;

    clearProductLookupSlowTimer();
    setBackendResult(data);

    if (isInsufficientResult(data)) {
      startPhotoFlow();
      renderUserResult(data);
      setUserMessage(
        data.decision?.warnings?.includes("product_not_found") ? "Ürün bulunamadı" : "Ürün bilgisi yetersiz",
        data.decision?.reason || "Etiket fotoğraflarıyla devam edebilirsiniz.",
        "#f3f4f6", { keepResult: true }
      );
    } else {
      renderUserResult(data);
      photoSection.classList.add("hidden");
    }
  } catch (e) {
    clearProductLookupSlowTimer();
    if (session !== accountGeneration) return;
    setBackendResult(e.payload || { error: e.message });
    const waitSeconds = e.payload?.meta?.sourceLookup?.retryAfterSeconds;
    const message = Number.isFinite(waitSeconds) && waitSeconds > 0
      ? `${e.message} En az ${waitSeconds} saniye bekleyin.` : e.message;
    setUserMessage(e.code === "SOURCE_UNAVAILABLE" ? "Ürün kaynağına erişilemiyor" : "Bağlantı hatası", message, "#fee2e2");
    showRetry(scanProduct);
  } finally {
    clearProductLookupSlowTimer();
    setProductLookupBusy(false);
  }
}

async function loadImageFromFile(file) {
  const imgUrl = URL.createObjectURL(file);

  try {
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("Fotoğraf açılamadı. JPEG veya PNG seçin ya da etiketi yeniden çekin."));
      im.src = imgUrl;
    });

    return img;
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

async function prepareImageBlob(file, maxDim = 1280, quality = 0.9) {
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) throw new Error("En fazla 10 MB boyutunda bir fotoğraf seçin.");
  const img = await loadImageFromFile(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
  if (w < 320 || h < 240 || w * h > 16000000) throw new Error("Fotoğrafın boyutu uygun değil. Net ve daha yakın bir etiket fotoğrafı seçin.");
  const scale = Math.min(1, maxDim / Math.max(w, h));
  const nw = Math.round(w * scale);
  const nh = Math.round(h * scale);
  const canvas = document.createElement("canvas");
  canvas.width = nw;
  canvas.height = nh;

  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, nw, nh);

  return new Promise(resolve => {
    canvas.toBlob(blob => resolve(blob), "image/jpeg", quality);
  });
}

async function blobToBase64(blob) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });

  return String(dataUrl).split(",")[1];
}

async function buildImagePayload(role, file) {
  const preparedBlob = await prepareImageBlob(file);
  const imageBase64 = await blobToBase64(preparedBlob);

  return {
    role,
    imageBase64,
    mimeType: "image/jpeg"
  };
}

async function analyzePhotoFlow() {
  if (photoAnalysisInFlight || productLookupInFlight) return;
  if (!ensureQuerySession()) return;
  if (!document.getElementById("externalProcessingConsent").checked) {
    setUserMessage("İşleme onayı gerekli", "Fotoğraf ve etiket metninin işlenmesi hakkındaki açıklamayı okuyup onaylayın.", "#fef3c7");
    return;
  }
  if (!photoFiles.front) {
    showPhotoStep("front");
    return;
  }

  if (!photoFiles.ingredients) {
    showPhotoStep("ingredients");
    return;
  }

  hideRetry();
  const cancel = document.getElementById('cancelPhotoAnalysis');
  const quotaNotice = document.getElementById('photoQuotaNotice');
  quotaNotice.textContent = '';
  const controller = new AbortController();
  activePhotoRequest = controller;
  const barcode = (barcodeInputEl.value || '').trim();
  const files = [photoFiles.front, photoFiles.ingredients, photoFiles.extra];
  if (!photoAttempt || photoAttempt.barcode !== barcode || files.some((file, index) => photoAttempt.files[index] !== file)) {
    photoAttempt = { barcode, files, id: crypto.randomUUID() };
  }
  const requestId = photoAttempt.id;
  photoAnalysisInFlight = true;
  for (const button of photoSection.querySelectorAll("button")) button.disabled = true;
  cancel.disabled = false;
  cancel.classList.remove('hidden');
  setProductLookupBusy(true);
  setUserMessage("Fotoğraflar analiz ediliyor", "Bu kısım biraz sürebilir.", "#f3f4f6");

  try {
    setBackendResult("Fotoğraf analizi sürüyor; henüz yeni bir sonuç yok.");
    const images = [
      await buildImagePayload("front", files[0]),
      await buildImagePayload("ingredients", files[1])
    ];

    if (files[2]) {
      images.push(await buildImagePayload("extra", files[2]));
    }

    if (controller.signal.aborted) return;
    const data = await accountRequest("/analyze-images", {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode: barcode || undefined,
        requestId,
        images,
        externalProcessingConsent: true,
        externalProcessingConsentVersion: "2026-11-03.3"
      })
    }, 65000);
    if (controller.signal.aborted) return;
    photoAttempt = null;

    setBackendResult(data);
    renderUserResult(data);
    const remaining = data?.meta?.photoQuotaRemaining;
    if (Number.isInteger(remaining) && remaining >= 0 && remaining <= 3) {
      quotaNotice.textContent = remaining ? `Bu ay ${remaining} fotoğraf analizi hakkınız kaldı.` : 'Bu ayki fotoğraf analizi hakkınız doldu.';
    }

    const extracted = data?.extracted;
    if (extracted) {
      ocrTextEl.value = JSON.stringify(extracted, null, 2);
    }
  } catch (e) {
    if (controller.signal.aborted || e.code === 'PHOTO_CANCELLED') {
      if (accessToken) setUserMessage('Analiz durduruldu', 'Fotoğraflarınız seçili kaldı.', '#f3f4f6');
      return;
    }
    setBackendResult({ error: e.message });
    setUserMessage("Analiz hatası", e.message, "#fee2e2");
    if (e.code === 'PHOTO_ALREADY_SUBMITTED') photoAttempt = null;
    if (!['AUTH_REQUIRED', 'PHOTO_ACCOUNT_LIMIT'].includes(e.code)) showRetry(analyzePhotoFlow);
  } finally {
    if (activePhotoRequest === controller) activePhotoRequest = null;
    cancel.classList.add('hidden');
    photoAnalysisInFlight = false;
    setProductLookupBusy(false);
    for (const button of photoSection.querySelectorAll("button")) button.disabled = false;
    updatePhotoProgress();
  }
}

function handlePhotoSelected(role, file) {
  if (!file || photoAnalysisInFlight) return;
  if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
    setUserMessage("Fotoğraf uygun değil", "En fazla 10 MB boyutunda bir fotoğraf seçin.", "#fef3c7");
    return;
  }
  if (previewUrls.has(role)) URL.revokeObjectURL(previewUrls.get(role));
  previewUrls.set(role, URL.createObjectURL(file));
  const replacing = !!photoFiles[role];
  photoFiles[role] = file;
  updatePhotoProgress();
  if (replacing) {
    setBackendResult("Fotoğraf değiştirildi; henüz yeni bir sonuç yok.");
    setUserMessage("Fotoğraf değiştirildi", "Güncel sonuç için seçili tüm fotoğraflarla yeniden analiz edin.", "#fef3c7");
    return;
  }

  if (role === "front") {
    showPhotoStep("ingredients");
    return;
  }

  if (role === "ingredients") {
    showPhotoStep("extraChoice");
    return;
  }

  showPhotoStep("extraChoice");
}

async function analyzeTextFromDebug() {
  if (!ensureQuerySession()) return;
  const labelText = (ocrTextEl.value || "").trim();
  const barcode = (barcodeInputEl.value || "").trim();

  if (!labelText || labelText.length < 3) {
    setBackendResult("Analiz için metin gir.");
    return;
  }

  const session = accountGeneration;
  setUserMessage('Etiket analiz ediliyor', 'Yeni sonuç hazırlanıyor.');
  setBackendResult('Etiket analizi sürüyor; henüz yeni bir sonuç yok.');
  try {
    const data = await accountRequest("/analyze-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        labelText,
        barcode: barcode || undefined
      })
    });

    if (session !== accountGeneration) return;
    setBackendResult(data);
    renderUserResult(data);
  } catch (e) {
    if (session !== accountGeneration) return;
    setBackendResult("Backend hatası: " + e.message);
  }
}

manualBarcodeBtn.addEventListener("click", showManualBarcode);
noBarcodeBtn.addEventListener("click", () => { if (!photoAnalysisInFlight && !productLookupInFlight) { barcodeInputEl.value = ""; startPhotoFlow(); } });
scanProductBtn.addEventListener("click", scanProduct);
barcodeInputEl.addEventListener("keydown", event => {
  if (event.key === "Enter") {
    scanProduct();
  }
});

startCameraBtn.addEventListener("click", startCameraScan);
stopCameraBtn.addEventListener("click", async () => {
  await stopCameraScan();
  startCameraBtn.focus();
});

choosePhotoBtn.addEventListener("click", () => {
  const input = PHOTO_STEPS[currentPhotoStep]?.input;
  if (input) input.click();
});

frontFileInput.addEventListener("change", () => {
  handlePhotoSelected("front", frontFileInput.files?.[0]);
});

ingredientsFileInput.addEventListener("change", () => {
  handlePhotoSelected("ingredients", ingredientsFileInput.files?.[0]);
});

extraFileInput.addEventListener("change", () => {
  handlePhotoSelected("extra", extraFileInput.files?.[0]);
});

addExtraPhotoBtn.addEventListener("click", () => showPhotoStep("extra"));
skipExtraPhotoBtn.addEventListener("click", analyzePhotoFlow);
document.getElementById("reanalyzeBtn").addEventListener("click", analyzePhotoFlow);
document.getElementById('cancelPhotoAnalysis').addEventListener('click', () => activePhotoRequest?.abort());
document.getElementById("retryBtn").addEventListener("click", () => { const retry = lastRetry; if (retry) retry(); });

toggleDebugBtn.addEventListener("click", () => {
  const hidden = debugPanel.classList.contains("hidden");
  debugPanel.classList.toggle("hidden", !hidden);
  toggleDebugBtn.textContent = hidden ? "Debug / Karar ayrıntılarını gizle" : "Debug / Karar ayrıntıları";
  toggleDebugBtn.setAttribute("aria-expanded", String(hidden));
});

analyzeTextBtn.addEventListener("click", analyzeTextFromDebug);

document.getElementById("contributionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("submitContributionBtn");
  if (button.disabled) return;
  if (!accessToken) { document.getElementById("contributionStatus").textContent = "Önce hesabınıza giriş yapın."; return; }
  if (!currentContributionContext?.token) { document.getElementById("contributionStatus").textContent = "Katkı için geçerli bir tarama sonucu gerekli. Ürünü yeniden tarayın."; return; }
  const session = accountGeneration, context = currentContributionContext;
  const isCurrent = () => session === accountGeneration && context === currentContributionContext;
  const kind = document.getElementById("contributionKind").value;
  const note = document.getElementById("contributionNote").value;
  const structuredFields = kind === "new_product"
    ? { productName: document.getElementById("contributionProductName").value.trim(), brand: document.getElementById("contributionBrand").value.trim() }
    : kind === "label_correction"
      ? { currentValue: document.getElementById("contributionCurrentValue").value.trim(), proposedValue: document.getElementById("contributionProposedValue").value.trim() }
      : { errorType: document.getElementById("contributionErrorType").value };
  const consent = document.getElementById("moderationPhotoConsent").checked;
  const hasPhotos = Object.values(contributionPhotoFiles).some(Boolean) || Object.values(contributionStagedMedia).some(Boolean);
  if (hasPhotos && !consent) { document.getElementById("contributionStatus").textContent = "Fotoğraf kanıtını kaydetmek için ayrı moderasyon saklama onayı gerekli."; return; }
  button.disabled = true;
  try {
    const mediaIds = [];
    for (const role of Object.keys(contributionPhotoFiles)) {
      if (!contributionStagedMedia[role] && contributionPhotoFiles[role]) {
        document.getElementById("contributionStatus").textContent = "Fotoğraflar doğrulanıp özel alana yükleniyor…";
        const image = await prepareImageBlob(contributionPhotoFiles[role], 1280, 0.82);
        if (!isCurrent()) return;
        if (!image) throw new Error("Fotoğraf dönüştürülemedi. Başka bir görsel deneyin.");
        const uploaded = await requestJson("/contributions/media", { method: "POST", headers: {
          "Content-Type": "image/jpeg", Authorization: `Bearer ${accessToken}`,
          "X-Contribution-Barcode": currentContributionContext.barcode,
          "X-Contribution-Context": currentContributionContext.token,
          "X-Contribution-Media-Role": role,
          "X-Moderation-Photo-Consent": CONTRIBUTION_PHOTO_CONSENT_VERSION
        }, body: image }, 35000);
        if (!isCurrent()) return;
        contributionStagedMedia[role] = uploaded.media.id;
      }
      if (contributionStagedMedia[role]) mediaIds.push(contributionStagedMedia[role]);
    }
    const requestFingerprint = JSON.stringify([currentContributionContext.token, kind, note.trim(), structuredFields, mediaIds, document.getElementById("retentionConsent").checked, consent]);
    if (!contributionAttempt || contributionAttempt.fingerprint !== requestFingerprint) {
      const bytes = new Uint8Array(16); crypto.getRandomValues(bytes); bytes[6] = (bytes[6] & 0x0f) | 0x40; bytes[8] = (bytes[8] & 0x3f) | 0x80;
      const hex = [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
      const idempotencyKey = `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      contributionAttempt = { fingerprint: requestFingerprint, idempotencyKey };
    }
    document.getElementById("contributionStatus").textContent = "Katkı ve kanıtlar incelemeye gönderiliyor…";
    const result = await accountRequest("/contributions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ barcode: currentContributionContext.barcode, contextToken: currentContributionContext.token, idempotencyKey: contributionAttempt.idempotencyKey, kind, note, retentionConsent: document.getElementById("retentionConsent").checked, structuredFields, mediaIds }) });
    if (!isCurrent()) return;
    document.getElementById("contributionStatus").textContent = result.message;
    document.getElementById("contributionForm").reset();
    clearContributionPhotos(false); contributionAttempt = null; updateContributionKindFields();
    if (kind === "decision_dispute") {
      userResultEl.replaceChildren();
      const pending = document.createElement("p");
      pending.textContent = "Bu sonuç itiraz nedeniyle yeniden incelenecek. Önceki sonucu uygunluk kanıtı olarak kullanmayın.";
      userResultEl.appendChild(pending);
    }
  } catch (error) { if (isCurrent()) document.getElementById("contributionStatus").textContent = error.message; }
  finally { button.disabled = false; }
});

for (const [role, inputId] of [["front_label","contributionFrontPhoto"],["ingredients_panel","contributionIngredientsPhoto"],["extra","contributionExtraPhoto"]]) {
  document.getElementById(inputId).addEventListener("change", event => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    const oldStaged = contributionStagedMedia[role];
    if (oldStaged && accessToken) accountRequest(`/contributions/media/${encodeURIComponent(oldStaged)}`, { method: "DELETE" }).catch(() => {});
    if (contributionPreviewUrls.has(role)) URL.revokeObjectURL(contributionPreviewUrls.get(role));
    contributionStagedMedia[role] = null; contributionPhotoFiles[role] = file;
    contributionPreviewUrls.set(role, URL.createObjectURL(file));
    renderContributionPhotoPreviews(); updateContributionKindFields(); contributionAttempt = null;
  });
}
document.getElementById("contributionKind").addEventListener("change", updateContributionKindFields);
document.getElementById("moderationPhotoConsent").addEventListener("change", event => {
  if (event.target.checked) return;
  for (const [role, id] of Object.entries(contributionStagedMedia)) if (id && accessToken) accountRequest(`/contributions/media/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  for (const role of Object.keys(contributionStagedMedia)) contributionStagedMedia[role] = null;
  contributionAttempt = null; updateContributionKindFields();
});
updateContributionKindFields();
// Keep diagnostics available during the pilot; disable explicitly at public launch.
if (window.EATSURE_CONFIG?.enableDebug === false) document.querySelector(".debug-shell").classList.add("hidden");
document.addEventListener('visibilitychange', () => {
  if (!document.hidden || !cameraRunning) return;
  stopCameraScan();
  setUserMessage('Kamera durduruldu', 'Barkodu taramak için kamerayı yeniden açın veya barkodu elle girin.');
});
function updateConnectionNotice() {
  const notice = document.getElementById('offlineNotice');
  const offline = !navigator.onLine;
  if (offline) {
    notice.textContent = 'Bağlantı yok. Barkod ve fotoğraf sorguları için yeniden internete bağlanın.';
    document.getElementById('scanAnnouncement').textContent = notice.textContent;
  } else if (notice.textContent) {
    notice.textContent = '';
    document.getElementById('scanAnnouncement').textContent = 'Bağlantı yeniden kuruldu.';
  }
}
window.addEventListener('offline', updateConnectionNotice);
window.addEventListener('online', updateConnectionNotice);
updateConnectionNotice();
window.addEventListener("pagehide", event => {
  stopCameraScan();
  activePhotoRequest?.abort();
  if (!event.persisted) {
    for (const url of previewUrls.values()) URL.revokeObjectURL(url);
    for (const url of contributionPreviewUrls.values()) URL.revokeObjectURL(url);
  }
});
