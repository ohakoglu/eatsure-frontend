const BACKEND_BASE = "https://eatsure-backend-4dkh.onrender.com";

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
let html5QrCode = null;
let cameraRunning = false;

/* -------------------------------- */
/* Helpers */
/* -------------------------------- */

function getBaseUrl() {
  return BACKEND_BASE.replace(/\/+$/, "");
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

function hidePhotoSection() {
  photoSection.classList.add("hidden");
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

function renderUserResult(data) {

  const level = data?.decision?.level || "insufficient_data";
  const ui = LEVEL_UI[level] || LEVEL_UI.insufficient_data;

  const reason = data?.decision?.reason || "";
  const brand = data?.brand || "";
  const name = data?.name || "";

  userResultEl.classList.remove("empty-state");
  userResultEl.style.background = ui.color;

  userResultEl.innerHTML = `
    <h3>${ui.title}</h3>
    <p><strong>${[brand, name].filter(Boolean).join(" / ")}</strong></p>
    <p>${reason}</p>
  `;

}

function updatePhotoPrompt(data) {

  const level = data?.decision?.level || "insufficient_data";

  if (level === "insufficient_data") {
    hidePhotoPrompt();
    showPhotoSection();
    return;
  }

  showPhotoPrompt("İstersen daha ayrıntılı kontrol için etiket fotoğrafı da ekleyebilirsin.");
  hidePhotoSection();
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
  hidePhotoSection();
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

  try {

    html5QrCode = new Html5Qrcode("reader");

    await html5QrCode.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: 220 },
      async (decodedText) => {

        barcodeInputEl.value = decodedText;

        await stopCameraScan();

        scanProduct();

      }
    );

    cameraRunning = true;

  } catch (e) {

    setBackendResult("Kamera açılamadı: " + e.message);

  }

}

async function stopCameraScan() {

  if (!cameraRunning || !html5QrCode) return;

  try {

    await html5QrCode.stop();
    await html5QrCode.clear();

  } catch {}

  cameraRunning = false;
  readerEl.innerHTML = "";

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
