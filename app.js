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
    title: "Çölyak için uygundur",
    color: "#dcfce7"
  },
  declared_gf_with_ingredients: {
    title: "Üretici beyanına göre glutensiz",
    color: "#ecfccb"
  },
  declared_gf_no_ingredients: {
    title: "Üretici glutensiz beyanı",
    color: "#fef3c7"
  },
  gluten_present: {
    title: "Çölyak için uygun değil",
    color: "#fee2e2"
  },
  declaration_conflict: {
    title: "Çelişkili bilgi",
    color: "#ffedd5"
  },
  ingredients_safe_no_claim: {
    title: "Glutensiz olduğu doğrulanamadı",
    color: "#fef3c7"
  },
  insufficient_data: {
    title: "Bilgi yetersiz",
    color: "#f3f4f6"
  },
  certification_suspended: {
    title: "Sertifika geçersiz",
    color: "#ffedd5"
  }
};

function getBaseUrl() {
  const configuredBase =
    window.EATSURE_CONFIG?.backendBase ||
    window.localStorage?.getItem("EATSURE_BACKEND_BASE") ||
    DEFAULT_BACKEND_BASE;

  return String(configuredBase).replace(/\/+$/, "");
}


async function requestJson(path, options = {}, timeoutMs = 70000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${getBaseUrl()}${path}`, { ...options, signal: controller.signal });
    let data = {};
    if (response.status !== 204) {
      try { data = await response.json(); } catch { throw new Error("Sunucu yanıtı okunamadı. Lütfen tekrar deneyin."); }
    }
    if (!response.ok) {
      if (response.status === 401) { accessToken = null; updateSession(); }
      throw new Error(data.message || (response.status === 429 ? "Çok fazla istek. Biraz sonra tekrar deneyin." : "İstek tamamlanamadı. Lütfen tekrar deneyin."));
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") throw new Error("İstek zaman aşımına uğradı. Fotoğraflarınız korunuyor; tekrar deneyebilirsiniz.");
    throw error;
  } finally { clearTimeout(timer); }
}
function showRetry(action) {
  lastRetry = action;
  document.getElementById("retryBtn").classList.remove("hidden");
}
function hideRetry() { document.getElementById("retryBtn").classList.add("hidden"); lastRetry = null; }
function updateSession() {
  document.getElementById("sessionStatus").textContent = accessToken ? "Oturum açık. Katkı ve itiraz gönderebilirsiniz." : "Katkı göndermek için mevcut hesabınızla oturum açın.";
  document.getElementById("logoutBtn").classList.toggle("hidden", !accessToken);
  if (!accessToken) document.getElementById("contributionHistory").replaceChildren();
}

function setBackendResult(data) {
  if (typeof data === "string") {
    backendResultEl.textContent = data;
  } else {
    backendResultEl.textContent = JSON.stringify(data, null, 2);
  }
}

function setUserMessage(title, message, color = "#f3f4f6", options = {}) {
  resultSection.classList.add("hidden");
  statusSection.classList.remove("hidden");
  userStatusEl.classList.toggle("is-loading", !!options.loading);
  userStatusEl.style.background = color;
  userStatusEl.replaceChildren();

  const titleEl = document.createElement("h3");
  titleEl.textContent = title;

  const messageEl = document.createElement("p");
  messageEl.textContent = message;

  userStatusEl.append(titleEl, messageEl);
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

function renderUserResult(data) {
  statusSection.classList.add("hidden");
  resultSection.classList.remove("hidden");

  const level = data?.decision?.level || "insufficient_data";
  const ui = LEVEL_UI[level] || LEVEL_UI.insufficient_data;
  const reason = data?.decision?.reason || "";
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
  const sourcesEl = document.createElement("p");
  sourcesEl.textContent = `Karar kaynakları: ${(data.decision?.sources || []).join(", ") || "Yeterli kaynak yok"}`;
  userResultEl.appendChild(sourcesEl);
  const dateEl = document.createElement("p");
  const sourceDate = data.decision?.ui?.sourceDate;
  dateEl.textContent = sourceDate && Number.isFinite(Date.parse(sourceDate)) ? `${data.decision?.ui?.staleFallback ? "Eski kaynak — yeniden doğrulama gerekli" : "Değerlendirme tarihi"}: ${new Date(sourceDate).toLocaleString("tr-TR")}` : "Kaynak tarihi doğrulanamadı";
  userResultEl.appendChild(dateEl);
  for (const warning of data.decision?.warnings || []) {
    const warningEl = document.createElement("p");
    const qualityWarnings = {
      ocr_confidence_unavailable: "Metnin bazı bölümlerinde okuma güveni ölçülemiyor. Sonucu etiketle karşılaştırın.",
      ocr_confidence_low: "Bazı kelimeler güvenilir okunamadı. Etiketi net ve yakın çekerek yeniden deneyin.",
      ingredients_photo_unverified: "İçindekiler fotoğrafındaki içerik listesi doğrulanamadı. Bu yüzü yeniden çekin.",
      independent_review_unavailable: "Ek görsel kontrol tamamlanamadı. Mevcut risk uyarılarını dikkate alın; daha sonra yeniden deneyin.",
      independent_review_required: "Fotoğraf ve etiket değerlendirmesi arasındaki bulgular çözülemedi. Mevcut risk uyarılarını dikkate alın; üreticiden doğrulama veya uzman incelemesi gerekiyor."
    };
    warningEl.textContent = qualityWarnings[warning] || (warning.includes("oat") ? "Yulaf bulundu. Glutensiz üretim ve bulaş riski ayrıca doğrulanmalıdır." : `Uyarı: ${warning}`);
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
  document.getElementById("contributionSection").classList.remove("hidden");
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

function startPhotoFlow() {
  if (photoAnalysisInFlight) return;
  for (const url of previewUrls.values()) URL.revokeObjectURL(url);
  previewUrls.clear();
  photoFiles = {
    front: null,
    ingredients: null,
    extra: null
  };

  frontFileInput.value = "";
  ingredientsFileInput.value = "";
  extraFileInput.value = "";

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

async function startZxingWithFallback(reader, videoEl, callback) {
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

function stopVideoTracks() {
  const videoEl = readerEl.querySelector("video");
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
    setUserMessage("Kamera hazır değil", "Barkod okuyucu yüklenemedi. İnternet bağlantısını kontrol et.", "#fee2e2");
    return;
  }

  try {
    cameraRunning = true;
    barcodeDetected = false;
    stopCameraBtn.classList.remove("hidden");
    setUserMessage("Barkod taranıyor", "Barkodu net ve iyi ışıkta kameraya göster.", "#f3f4f6");

    barcodeCodeReader = createZxingReader(zxing);
    const videoEl = createBarcodeVideoElement();

    const callback = async (result, error) => {
      if (barcodeDetected) return;

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

    barcodeScanControls = await startZxingWithFallback(
      barcodeCodeReader,
      videoEl,
      callback
    );
  } catch (e) {
    console.error("Kamera barkod tarama hatası:", e);
    await stopCameraScan();
    setUserMessage("Kamera açılamadı", e.message || "Barkod okuyucu başlatılamadı.", "#fee2e2");
  }
}

async function scanProduct() {
  if (productLookupInFlight || photoAnalysisInFlight) {
    return;
  }

  const barcode = (barcodeInputEl.value || "").trim();

  if (!/^\d{8,14}$/.test(barcode)) {
    setUserMessage("Barkod gerekli", "Barkodu gir ya da barkodsuz fotoğraf akışını başlat.", "#fef3c7");
    showManualBarcode();
    return;
  }

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
    const data = await requestJson(`/scan/${encodeURIComponent(barcode)}`, {}, 20000);

    clearProductLookupSlowTimer();
    setBackendResult(data);
    renderUserResult(data);

    if (isInsufficientResult(data)) {
      startPhotoFlow();
    } else {
      photoSection.classList.add("hidden");
    }
  } catch (e) {
    clearProductLookupSlowTimer();
    setUserMessage("Bağlantı hatası", e.message, "#fee2e2");
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
      im.onerror = reject;
      im.src = imgUrl;
    });

    return img;
  } finally {
    URL.revokeObjectURL(imgUrl);
  }
}

async function prepareImageBlob(file, maxDim = 1280) {
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
    canvas.toBlob(blob => resolve(blob), "image/jpeg", 0.9);
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
  photoAnalysisInFlight = true;
  for (const button of photoSection.querySelectorAll("button")) button.disabled = true;
  setProductLookupBusy(true);
  setUserMessage("Fotoğraflar analiz ediliyor", "Bu kısım biraz sürebilir.", "#f3f4f6");

  try {
    const images = [
      await buildImagePayload("front", photoFiles.front),
      await buildImagePayload("ingredients", photoFiles.ingredients)
    ];

    if (photoFiles.extra) {
      images.push(await buildImagePayload("extra", photoFiles.extra));
    }

    const data = await requestJson("/analyze-images", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode: (barcodeInputEl.value || "").trim() || undefined,
        images,
        externalProcessingConsent: true,
        externalProcessingConsentVersion: "2026-11-03.3"
      })
    }, 120000);

    setBackendResult(data);
    renderUserResult(data);

    const extracted = data?.extracted;
    if (extracted) {
      ocrTextEl.value = JSON.stringify(extracted, null, 2);
    }
  } catch (e) {
    setUserMessage("Analiz hatası", e.message, "#fee2e2");
    showRetry(analyzePhotoFlow);
  } finally {
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
  const labelText = (ocrTextEl.value || "").trim();
  const barcode = (barcodeInputEl.value || "").trim();

  if (!labelText || labelText.length < 3) {
    setBackendResult("Analiz için metin gir.");
    return;
  }

  try {
    const data = await requestJson("/analyze-label", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        labelText,
        barcode: barcode || undefined
      })
    });

    setBackendResult(data);
    renderUserResult(data);
  } catch (e) {
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
stopCameraBtn.addEventListener("click", stopCameraScan);

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
document.getElementById("retryBtn").addEventListener("click", () => { const retry = lastRetry; if (retry) retry(); });

toggleDebugBtn.addEventListener("click", () => {
  const hidden = debugPanel.classList.contains("hidden");
  debugPanel.classList.toggle("hidden", !hidden);
  toggleDebugBtn.textContent = hidden ? "Debug Gizle" : "Debug";
});

analyzeTextBtn.addEventListener("click", analyzeTextFromDebug);

// Tokens remain in memory and are cleared on reload/sign-out.
document.getElementById("loginForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("loginBtn");
  button.disabled = true;
  try {
    const result = await requestJson("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: document.getElementById("emailInput").value, password: document.getElementById("passwordInput").value }) });
    accessToken = result.accessToken;
    updateSession();
  } catch (error) { document.getElementById("sessionStatus").textContent = error.message; }
  finally { document.getElementById("passwordInput").value = ""; button.disabled = false; }
});
document.getElementById("logoutBtn").addEventListener("click", () => { accessToken = null; updateSession(); });
document.getElementById("contributionForm").addEventListener("submit", async event => {
  event.preventDefault();
  const button = document.getElementById("submitContributionBtn");
  if (!accessToken) { document.getElementById("contributionStatus").textContent = "Önce hesabınıza giriş yapın."; return; }
  button.disabled = true;
  try {
    const result = await requestJson("/contributions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${accessToken}` }, body: JSON.stringify({ barcode: barcodeInputEl.value.trim(), kind: document.getElementById("contributionKind").value, note: document.getElementById("contributionNote").value, retentionConsent: document.getElementById("retentionConsent").checked }) });
    document.getElementById("contributionStatus").textContent = result.message;
    if (document.getElementById("contributionKind").value === "decision_dispute") {
      userResultEl.replaceChildren();
      const pending = document.createElement("p");
      pending.textContent = "Bu sonuç itiraz nedeniyle yeniden incelenecek. Önceki sonucu uygunluk kanıtı olarak kullanmayın.";
      userResultEl.appendChild(pending);
    }
  } catch (error) { document.getElementById("contributionStatus").textContent = error.message; }
  finally { button.disabled = false; }
});
if (window.EATSURE_CONFIG?.enableDebug !== true) document.querySelector(".debug-shell").classList.add("hidden");
window.addEventListener("pagehide", event => { if (!event.persisted) for (const url of previewUrls.values()) URL.revokeObjectURL(url); });

document.getElementById("loadContributionsBtn").addEventListener("click", async () => {
  const list = document.getElementById("contributionHistory");
  list.replaceChildren();
  if (!accessToken) { list.textContent = "Önce hesabınıza giriş yapın."; return; }
  try {
    const data = await requestJson("/contributions/mine", { headers: { Authorization: `Bearer ${accessToken}` } });
    for (const contribution of data.contributions) {
      const item = document.createElement("li");
      item.textContent = `${contribution.barcode}: ${contribution.status} — ${new Date(contribution.created_at).toLocaleDateString("tr-TR")}`;
      const remove = document.createElement("button");
      remove.textContent = "Açıklamamı sil";
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await requestJson(`/contributions/${encodeURIComponent(contribution.id)}/delete`, { method: "POST", headers: { Authorization: `Bearer ${accessToken}` } });
          item.textContent = `${contribution.barcode}: açıklama silindi. İnceleme işlem kaydı korunur.`;
        } catch (error) { list.appendChild(document.createTextNode(error.message)); remove.disabled = false; }
      });
      item.appendChild(remove); list.appendChild(item);
    }
    if (!data.contributions.length) list.textContent = "Henüz katkı yok.";
  } catch (error) { list.textContent = error.message; }
});
