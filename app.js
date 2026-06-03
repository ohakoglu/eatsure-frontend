const DEFAULT_BACKEND_BASE = "https://eatsure-backend-4dkh.onrender.com";

const barcodeInputEl = document.getElementById("barcodeInput");
const scanProductBtn = document.getElementById("scanProductBtn");
const startCameraBtn = document.getElementById("startCameraBtn");
const stopCameraBtn = document.getElementById("stopCameraBtn");

const readerEl = document.getElementById("reader");

const photoSection = document.getElementById("photoSection");
const photoPromptSection = document.getElementById("photoPromptSection");
const photoPromptText = document.getElementById("photoPromptText");
const openPhotoSectionBtn = document.getElementById("openPhotoSectionBtn");

const fileInput = document.getElementById("fileInput");
const previewImg = document.getElementById("previewImg");

const runOcrBtn = document.getElementById("runOcr");
const sendToBackendBtn = document.getElementById("sendToBackend");
const analyzeTextBtn = document.getElementById("analyzeTextBtn");

const ocrTextEl = document.getElementById("ocrText");
const backendResultEl = document.getElementById("backendResult");
const userResultEl = document.getElementById("userResult");

const toggleDebugBtn = document.getElementById("toggleDebugBtn");
const debugPanel = document.getElementById("debugPanel");

let selectedFile = null;
let barcodeCodeReader = null;
let barcodeScanControls = null;
let barcodeDetector = null;
let barcodeDetectorLoopId = null;
let cameraRunning = false;
let barcodeDetected = false;

/* -------------------------------- */
/* Helpers */
/* -------------------------------- */

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

function showPhotoSection() {
  photoSection.classList.remove("hidden");
}

function showPhotoPrompt(text) {
  photoPromptText.textContent = text;
  photoPromptSection.classList.remove("hidden");
}

function hidePhotoPrompt() {
  photoPromptText.textContent = "";
  photoPromptSection.classList.add("hidden");
}

function scrollToPhotoSection() {
  photoSection.scrollIntoView({ behavior: "smooth", block: "start" });
}

function openPhotoFlow() {
  showPhotoSection();
  scrollToPhotoSection();
}

function normalizeBarcodeText(value) {
  return String(value || "").replace(/\D/g, "").trim();
}

function isLikelyBarcode(value) {
  const cleaned = normalizeBarcodeText(value);
  return cleaned.length >= 8 && cleaned.length <= 14;
}

function createBarcodeVideoElement() {
  readerEl.replaceChildren();

  const videoEl = document.createElement("video");

  videoEl.setAttribute("playsinline", "true");
  videoEl.setAttribute("muted", "true");
  videoEl.autoplay = true;
  videoEl.muted = true;

  videoEl.style.width = "100%";
  videoEl.style.maxHeight = "360px";
  videoEl.style.objectFit = "cover";
  videoEl.style.borderRadius = "12px";
  videoEl.style.background = "#111";

  readerEl.appendChild(videoEl);

  return videoEl;
}

function getBarcodeHints() {
  if (!window.ZXing) return undefined;

  const hints = new Map();

  hints.set(ZXing.DecodeHintType.POSSIBLE_FORMATS, [
    ZXing.BarcodeFormat.EAN_13,
    ZXing.BarcodeFormat.EAN_8,
    ZXing.BarcodeFormat.UPC_A,
    ZXing.BarcodeFormat.UPC_E,
    ZXing.BarcodeFormat.CODE_128,
    ZXing.BarcodeFormat.CODE_39,
    ZXing.BarcodeFormat.ITF
  ]);

  hints.set(ZXing.DecodeHintType.TRY_HARDER, true);

  return hints;
}

async function getPreferredBackCameraDeviceId(codeReader) {
  try {
    if (!codeReader || typeof codeReader.listVideoInputDevices !== "function") {
      return null;
    }

    const devices = await codeReader.listVideoInputDevices();

    if (!Array.isArray(devices) || devices.length === 0) {
      return null;
    }

    const backCamera = devices.find(device => {
      const label = String(device.label || "").toLowerCase();

      return (
        label.includes("back") ||
        label.includes("rear") ||
        label.includes("environment") ||
        label.includes("arka")
      );
    });

    return backCamera?.deviceId || devices[0]?.deviceId || null;
  } catch {
    return null;
  }
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

async function handleDetectedBarcode(rawText) {
  if (barcodeDetected) return false;

  const cleanedBarcode = normalizeBarcodeText(rawText);

  if (!isLikelyBarcode(cleanedBarcode)) {
    console.log("Barkod benzeri olmayan okuma:", rawText);
    return false;
  }

  barcodeDetected = true;
  console.log("BARKOD OKUNDU:", cleanedBarcode);

  barcodeInputEl.value = cleanedBarcode;

  await stopCameraScan();
  scanProduct();

  return true;
}

function createNativeBarcodeDetector() {
  if (!("BarcodeDetector" in window)) {
    return null;
  }

  try {
    return new BarcodeDetector({
      formats: [
        "ean_13",
        "ean_8",
        "upc_a",
        "upc_e",
        "code_128",
        "code_39",
        "itf"
      ]
    });
  } catch (err) {
    console.log("Native BarcodeDetector baslatilamadi:", err?.message || err);
    return null;
  }
}

function startNativeBarcodeDetection(videoEl) {
  barcodeDetector = createNativeBarcodeDetector();

  if (!barcodeDetector) {
    return;
  }

  const detect = async () => {
    if (!cameraRunning || barcodeDetected || !barcodeDetector) {
      return;
    }

    try {
      if (videoEl.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
        const barcodes = await barcodeDetector.detect(videoEl);
        const rawValue = barcodes?.[0]?.rawValue;

        if (rawValue && await handleDetectedBarcode(rawValue)) {
          return;
        }
      }
    } catch (err) {
      console.log("Native barkod okuma denemesi:", err?.message || err);
    }

    barcodeDetectorLoopId = window.requestAnimationFrame(detect);
  };

  barcodeDetectorLoopId = window.requestAnimationFrame(detect);
}

function stopNativeBarcodeDetection() {
  if (barcodeDetectorLoopId) {
    window.cancelAnimationFrame(barcodeDetectorLoopId);
  }

  barcodeDetectorLoopId = null;
  barcodeDetector = null;
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

/* -------------------------------- */
/* Debug panel */
/* -------------------------------- */

toggleDebugBtn.addEventListener("click", () => {

  const hidden = debugPanel.classList.contains("hidden");

  if (hidden) {
    debugPanel.classList.remove("hidden");
    toggleDebugBtn.textContent = "Debug Bilgilerini Gizle";
  } else {
    debugPanel.classList.add("hidden");
    toggleDebugBtn.textContent = "Debug Bilgilerini Göster";
  }

});

openPhotoSectionBtn.addEventListener("click", openPhotoFlow);

/* -------------------------------- */
/* Kullanıcı sonucu */
/* -------------------------------- */

const LEVEL_UI = {

  certified: {
    title: "✅ Çölyak için uygundur",
    color: "#dcfce7"
  },

  declared_gf_with_ingredients: {
    title: "🟢 Üretici beyanına göre glutensiz",
    color: "#ecfccb"
  },

  declared_gf_no_ingredients: {
    title: "🟡 Üretici glutensiz beyanı",
    color: "#fef3c7"
  },

  gluten_present: {
    title: "🔴 Gluten içeriyor",
    color: "#fee2e2"
  },

  declaration_conflict: {
    title: "🟠 Çelişkili bilgi",
    color: "#ffedd5"
  },

  ingredients_safe_no_claim: {
    title: "🟡 İçerik uygun görünüyor",
    color: "#fef3c7"
  },

  insufficient_data: {
    title: "⚪ Bilgi yetersiz",
    color: "#f3f4f6"
  }

};

Object.assign(LEVEL_UI, {
  certified: {
    ...LEVEL_UI.certified,
    title: "Colyak icin uygundur"
  },
  declared_gf_with_ingredients: {
    ...LEVEL_UI.declared_gf_with_ingredients,
    title: "Uretici beyanina gore glutensiz"
  },
  declared_gf_no_ingredients: {
    ...LEVEL_UI.declared_gf_no_ingredients,
    title: "Uretici glutensiz beyani"
  },
  gluten_present: {
    ...LEVEL_UI.gluten_present,
    title: "Gluten iceriyor"
  },
  declaration_conflict: {
    ...LEVEL_UI.declaration_conflict,
    title: "Celiskili bilgi"
  },
  ingredients_safe_no_claim: {
    ...LEVEL_UI.ingredients_safe_no_claim,
    title: "Icerik uygun gorunuyor"
  },
  insufficient_data: {
    ...LEVEL_UI.insufficient_data,
    title: "Bilgi yetersiz"
  }
});

function renderUserResult(data) {

  const level = data?.decision?.level || "insufficient_data";
  const ui = LEVEL_UI[level] || LEVEL_UI.insufficient_data;

  const reason = data?.decision?.reason || "";
  const brand = data?.brand || "";
  const name = data?.name || "";

  userResultEl.classList.remove("empty-state");
  userResultEl.style.background = ui.color;

  userResultEl.replaceChildren();

  const titleEl = document.createElement("h3");
  titleEl.textContent = ui.title;

  const productEl = document.createElement("p");
  const productStrongEl = document.createElement("strong");
  productStrongEl.textContent = [brand, name].filter(Boolean).join(" / ");
  productEl.appendChild(productStrongEl);

  const reasonEl = document.createElement("p");
  reasonEl.textContent = reason;

  userResultEl.append(titleEl, productEl, reasonEl);

}

function updatePhotoPrompt(data) {

  const level = data?.decision?.level || "insufficient_data";

  if (level === "insufficient_data") {
    showPhotoSection();
    showPhotoPrompt("Bilgi yetersiz. Daha iyi değerlendirme için aşağıdaki etiket fotoğrafı alanını kullanabilirsin.");
    return;
  }

  showPhotoPrompt("İstersen daha ayrıntılı kontrol için aşağıdaki etiket fotoğrafı alanını da kullanabilirsin.");
}

/* -------------------------------- */
/* Barkod sorgulama */
/* -------------------------------- */

async function scanProduct() {

  const barcode = (barcodeInputEl.value || "").trim();

  if (!barcode) {
    setBackendResult("Barkod giriniz.");
    return;
  }

  hidePhotoPrompt();
  showPhotoSection();
  setBackendResult("Ürün aranıyor...");

  try {

    const r = await fetch(`${getBaseUrl()}/scan/${barcode}`);
    const data = await r.json();

    setBackendResult(data);
    renderUserResult(data);
    updatePhotoPrompt(data);

  } catch (e) {

    setBackendResult("Backend hata: " + e.message);

  }

}

/* -------------------------------- */
/* Kamera barkod okuma */
/* -------------------------------- */

async function startCameraScan() {

  if (cameraRunning) {
    setBackendResult("Kamera zaten açık. Barkodu kameraya yaklaştır.");
    return;
  }

  if (!window.ZXing) {
    setBackendResult("ZXing barkod okuyucu yüklenmedi. İnternet bağlantısını kontrol et.");
    return;
  }

  try {

    cameraRunning = true;
    barcodeDetected = false;
    setBackendResult("Kamera açılıyor...");

    const hints = getBarcodeHints();
    barcodeCodeReader = new ZXing.BrowserMultiFormatReader(hints, 200);

    const videoEl = createBarcodeVideoElement();
    startNativeBarcodeDetection(videoEl);

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

    barcodeScanControls = await barcodeCodeReader.decodeFromVideoDevice(
      null,
      videoEl,
      callback
    );

    setBackendResult("Kamera açık. Barkodu net, iyi ışıkta ve kadrajı dolduracak şekilde göster.");

  } catch (e) {

    console.error("Kamera barkod tarama hatası:", e);

    setBackendResult("Kamera açılamadı veya barkod okuyucu başlatılamadı: " + e.message);

    cameraRunning = false;
    barcodeDetected = false;
    barcodeCodeReader = null;
    barcodeScanControls = null;
    stopNativeBarcodeDetection();
    stopVideoTracks();
    readerEl.replaceChildren();

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

  stopNativeBarcodeDetection();
  stopVideoTracks();

  cameraRunning = false;
  barcodeDetected = false;
  barcodeCodeReader = null;
  barcodeScanControls = null;
  readerEl.replaceChildren();

}

/* -------------------------------- */
/* Fotoğraf seçme */
/* -------------------------------- */

fileInput.addEventListener("change", () => {

  const f = fileInput.files?.[0];
  selectedFile = f;

  if (!f) {
    previewImg.style.display = "none";
    previewImg.src = "";
    return;
  }

  const url = URL.createObjectURL(f);

  previewImg.src = url;
  previewImg.style.display = "block";

});

/* -------------------------------- */
/* Görsel hazırlama */
/* -------------------------------- */

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

  const blob = await new Promise(resolve => {
    canvas.toBlob(b => resolve(b), "image/jpeg", 0.9);
  });

  return blob;

}

async function blobToBase64(blob) {

  const dataUrl = await new Promise((resolve, reject) => {

    const reader = new FileReader();

    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;

    reader.readAsDataURL(blob);

  });

  const s = String(dataUrl);

  return s.split(",")[1];

}

/* -------------------------------- */
/* AI Foto analiz */
/* -------------------------------- */

async function analyzeSelectedImage() {

  if (!selectedFile) {

    setBackendResult("Önce fotoğraf seç.");
    return;

  }

  setBackendResult("Fotoğraf hazırlanıyor...");

  try {

    const preparedBlob = await prepareImageBlob(selectedFile);

    const base64 = await blobToBase64(preparedBlob);

    const r = await fetch(`${getBaseUrl()}/analyze-image`, {

      method: "POST",

      headers: { "Content-Type": "application/json" },

      body: JSON.stringify({
        imageBase64: base64,
        mimeType: "image/jpeg",
        barcode: (barcodeInputEl.value || "").trim() || undefined
      })

    });

    const data = await r.json();

    setBackendResult(data);

    renderUserResult(data);
    showPhotoSection();
    hidePhotoPrompt();

    const extracted = data?.extracted;

    if (extracted) {

      ocrTextEl.value = JSON.stringify(extracted, null, 2);

    }

  } catch (e) {

    setBackendResult("Backend hata: " + e.message);

  }

}

/* -------------------------------- */
/* OCR test */
/* -------------------------------- */

async function runOcrOnImage() {

  if (!window.Tesseract) {

    setBackendResult("Tesseract yüklenmedi");

    return;

  }

  if (!selectedFile) {

    setBackendResult("Önce fotoğraf seç");

    return;

  }

  setBackendResult("OCR çalışıyor...");

  try {

    const blob = await prepareImageBlob(selectedFile);

    const { data } = await Tesseract.recognize(blob, "eng+tur");

    const text = data?.text || "";

    ocrTextEl.value = text;

    setBackendResult("OCR tamamlandı");

  } catch (e) {

    setBackendResult("OCR hata: " + e.message);

  }

}

/* -------------------------------- */
/* Metin analizi (debug/test) */
/* -------------------------------- */

async function analyzeTextFromDebug() {

  const labelText = (ocrTextEl.value || "").trim();
  const barcode = (barcodeInputEl.value || "").trim();

  if (!labelText || labelText.length < 3) {
    setBackendResult("Analiz için metin gir.");
    return;
  }

  setBackendResult("Metin analiz ediliyor...");

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

    setBackendResult("Backend hata: " + e.message);

  }

}

/* -------------------------------- */
/* Event binding */
/* -------------------------------- */

scanProductBtn.addEventListener("click", scanProduct);
startCameraBtn.addEventListener("click", startCameraScan);
stopCameraBtn.addEventListener("click", stopCameraScan);

sendToBackendBtn.addEventListener("click", analyzeSelectedImage);
runOcrBtn.addEventListener("click", runOcrOnImage);
analyzeTextBtn.addEventListener("click", analyzeTextFromDebug);
