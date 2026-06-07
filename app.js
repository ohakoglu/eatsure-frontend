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
    title: "Gluten içeriyor",
    color: "#fee2e2"
  },
  declaration_conflict: {
    title: "Çelişkili bilgi",
    color: "#ffedd5"
  },
  ingredients_safe_no_claim: {
    title: "İçerik uygun görünüyor",
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

  userResultEl.append(identityEl, titleEl, reasonEl);
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
    item.textContent = `${file ? "Tamam" : "Bekliyor"} - ${label}`;
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
  if (productLookupInFlight) {
    return;
  }

  const barcode = (barcodeInputEl.value || "").trim();

  if (!barcode) {
    setUserMessage("Barkod gerekli", "Barkodu gir ya da barkodsuz fotoğraf akışını başlat.", "#fef3c7");
    showManualBarcode();
    return;
  }

  await stopCameraScan();
  setProductLookupBusy(true);
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
    const r = await fetch(`${getBaseUrl()}/scan/${barcode}`);
    const data = await r.json();

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
    setUserMessage("Backend hatası", e.message, "#fee2e2");
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
  const img = await loadImageFromFile(file);
  const w = img.naturalWidth;
  const h = img.naturalHeight;
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
  if (!photoFiles.front) {
    showPhotoStep("front");
    return;
  }

  if (!photoFiles.ingredients) {
    showPhotoStep("ingredients");
    return;
  }

  setUserMessage("Fotoğraflar analiz ediliyor", "Bu kısım biraz sürebilir.", "#f3f4f6");

  try {
    const images = [
      await buildImagePayload("front", photoFiles.front),
      await buildImagePayload("ingredients", photoFiles.ingredients)
    ];

    if (photoFiles.extra) {
      images.push(await buildImagePayload("extra", photoFiles.extra));
    }

    const r = await fetch(`${getBaseUrl()}/analyze-images`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        barcode: (barcodeInputEl.value || "").trim() || undefined,
        images
      })
    });

    const data = await r.json();
    setBackendResult(data);
    renderUserResult(data);

    const extracted = data?.extracted;
    if (extracted) {
      ocrTextEl.value = JSON.stringify(extracted, null, 2);
    }
  } catch (e) {
    setUserMessage("Analiz hatası", e.message, "#fee2e2");
  }
}

function handlePhotoSelected(role, file) {
  if (!file) return;

  photoFiles[role] = file;

  if (role === "front") {
    showPhotoStep("ingredients");
    return;
  }

  if (role === "ingredients") {
    showPhotoStep("extraChoice");
    return;
  }

  analyzePhotoFlow();
}

async function analyzeTextFromDebug() {
  const labelText = (ocrTextEl.value || "").trim();
  const barcode = (barcodeInputEl.value || "").trim();

  if (!labelText || labelText.length < 3) {
    setBackendResult("Analiz için metin gir.");
    return;
  }

  try {
    const r = await fetch(`${getBaseUrl()}/analyze-label`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        labelText,
        barcode: barcode || undefined
      })
    });

    const data = await r.json();
    setBackendResult(data);
    renderUserResult(data);
  } catch (e) {
    setBackendResult("Backend hatası: " + e.message);
  }
}

manualBarcodeBtn.addEventListener("click", showManualBarcode);
noBarcodeBtn.addEventListener("click", startPhotoFlow);
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

toggleDebugBtn.addEventListener("click", () => {
  const hidden = debugPanel.classList.contains("hidden");
  debugPanel.classList.toggle("hidden", !hidden);
  toggleDebugBtn.textContent = hidden ? "Debug Gizle" : "Debug";
});

analyzeTextBtn.addEventListener("click", analyzeTextFromDebug);
