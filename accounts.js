// Account state stays in this tab. Authorization always comes from the server.
const accountEl = id => document.getElementById(id);
const STATUS_NAMES = { pending: 'İnceleme bekliyor', needs_more_info: 'Ek bilgi bekliyor', rejected: 'Reddedildi', approved: 'Onaylandı', withdrawn: 'Geri çekildi' };
const KIND_NAMES = { decision_dispute: 'Sonuca itiraz', label_correction: 'Etiket düzeltme', new_product: 'Yeni ürün' };
const ROLE_NAMES = { user: 'Kullanıcı', reviewer: 'İncelemeci', admin: 'Admin' };
let accountProfile = null;
let accountGeneration = 0;
let expiryTimer = null;
let reviewItems = [];
let selectedReview = null;
let queueGeneration = 0;
let historyGeneration = 0;
let passwordSetup = false;
let authOptionsLoaded = false;
let activationToken = null;

function textNode(tag, text, className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function readableDate(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('tr-TR') : 'Belirtilmemiş';
}
function canReview() { return Boolean(accessToken && ['admin', 'reviewer'].includes(accountProfile?.role)); }
function currentAccountPage() { return location.hash === '#admin' ? 'admin' : location.hash === '#profil' ? 'profile' : 'scan'; }

function updateSession() {
  const signedIn = Boolean(accessToken);
  accountEl('sessionStatus').textContent = signedIn ? 'Oturum açık.' : 'Mevcut EatSure hesabınla giriş yap.';
  accountEl('loginForm').classList.toggle('hidden', signedIn);
  accountEl('logoutBtn').classList.toggle('hidden', !signedIn);
  accountEl('profileContent').classList.toggle('hidden', !signedIn || !accountProfile);
  accountEl('reloadProfileBtn').classList.toggle('hidden', !signedIn || Boolean(accountProfile));
  accountEl('passwordSetup').classList.toggle('hidden', !signedIn || !passwordSetup);
  accountEl('activationCard').classList.toggle('hidden', !activationToken);
  accountEl('adminGate').classList.toggle('hidden', canReview());
  accountEl('adminContent').classList.toggle('hidden', !canReview());
  accountEl('adminGateMessage').textContent = !signedIn ? 'Yönetim alanına erişmek için yetkili hesabınla giriş yap.' :
    !accountProfile ? 'Yönetim yetkisi henüz doğrulanamadı. Profil sayfasından yeniden deneyebilirsin.' : 'Bu hesabın yönetim yetkisi yok. Kendi katkılarını Profilim sayfasından takip edebilirsin.';
}

function clearAccountSession(message) {
  accountGeneration++; queueGeneration++; historyGeneration++;
  clearTimeout(expiryTimer); accessToken = null; accountProfile = null; reviewItems = []; selectedReview = null;
  passwordSetup = false; accountEl('passwordSetupForm').reset(); accountEl('passwordStatus').textContent = '';
  activationToken = null; accountEl('activationStatus').textContent = '';
  for (const id of ['profileEmail', 'profileCreated', 'profileVerified', 'profileRole', 'contributionHistory', 'reviewQueue', 'budgetSummary', 'reviewNote', 'reviewBarcode', 'queueCount', 'profileStatus', 'reviewStatus', 'adminStatus', 'contributionStatus']) accountEl(id).replaceChildren();
  for (const id of ['loginForm', 'profileForm', 'reviewForm', 'contributionForm']) accountEl(id).reset();
  accountEl('reviewDetail').classList.add('hidden');
  updateSession();
  if (message) accountEl('sessionStatus').textContent = message;
}

async function accountRequest(path, options = {}) {
  const token = accessToken, generation = accountGeneration;
  if (!token) throw new Error('Önce hesabına giriş yap.');
  try {
    const data = await requestJson(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } });
    if (generation !== accountGeneration || token !== accessToken) throw new Error('Oturum değişti. Yeniden giriş yap.');
    return data;
  } catch (error) {
    if (error.status === 403 && generation === accountGeneration) {
      // Clear previously displayed privileged data immediately after a role revocation.
      accountProfile = null; reviewItems = []; selectedReview = null; queueGeneration++;
      accountEl('reviewQueue').replaceChildren(); accountEl('budgetSummary').replaceChildren();
      accountEl('reviewNote').replaceChildren(); accountEl('reviewBarcode').replaceChildren();
      accountEl('reviewForm').reset(); accountEl('reviewDetail').classList.add('hidden'); updateSession();
      error.message = 'Yönetim yetkisi doğrulanamadı. Profilini yeniden yükle.';
    }
    throw error;
  }
}

async function loadProfile() {
  const generation = accountGeneration;
  accountEl('sessionStatus').textContent = 'Profil yükleniyor…';
  try {
    const { profile } = await accountRequest('/profile');
    accountProfile = profile;
    accountEl('profileEmail').textContent = profile.email;
    accountEl('profileCreated').textContent = readableDate(profile.createdAt);
    accountEl('profileVerified').textContent = profile.emailConfirmed ? 'Doğrulandı' : 'Doğrulama bekliyor';
    accountEl('profileRole').textContent = ROLE_NAMES[profile.role] || ROLE_NAMES.user;
    accountEl('displayNameInput').value = profile.displayName || '';
    updateSession();
    await loadContributions();
    if (currentAccountPage() === 'admin' && canReview()) await loadAdmin();
  } catch (error) {
    if (generation !== accountGeneration) return;
    updateSession(); accountEl('sessionStatus').textContent = error.message;
  }
}

async function loadContributions() {
  const generation = ++historyGeneration, session = accountGeneration;
  const list = accountEl('contributionHistory');
  list.textContent = 'Katkılar yükleniyor…';
  try {
    const data = await accountRequest('/contributions/mine');
    if (generation !== historyGeneration) return;
    list.replaceChildren();
    for (const contribution of data.contributions) {
      const item = textNode('li', '', 'record-card');
      item.append(textNode('h4', contribution.barcode, 'record-title'), textNode('span', STATUS_NAMES[contribution.status] || 'Bilinmeyen durum', 'badge'),
        textNode('p', `${KIND_NAMES[contribution.kind] || 'Katkı'} · ${readableDate(contribution.created_at)}`, 'muted small'));
      if (contribution.review_note) item.append(textNode('p', contribution.review_note === 'Verified label approved' ? 'Doğrulanmış etiket onaylandı.' : contribution.review_note, 'preserve-lines'));
      const remove = textNode('button', 'Açıklamamı sil', 'btn btn-secondary btn-small');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        if (!window.confirm('Açıklaman ve hesap bağlantın silinecek. İnceleme işlem kaydı korunacak. Devam edilsin mi?')) return;
        remove.disabled = true;
        try {
          await accountRequest(`/contributions/${encodeURIComponent(contribution.id)}/delete`, { method: 'POST' });
          await loadContributions();
        } catch (error) {
          if (session === accountGeneration && generation === historyGeneration) { item.append(textNode('p', error.message, 'feedback')); remove.disabled = false; }
        }
      });
      if (contribution.status !== 'withdrawn') item.append(remove);
      list.append(item);
    }
    if (!data.contributions.length) list.append(textNode('li', 'Henüz katkın yok. Bir ürün sonucundan bilgi düzeltmesi veya itiraz gönderebilirsin.', 'empty-message'));
  } catch (error) { if (session === accountGeneration && generation === historyGeneration) list.textContent = error.message; }
}

function renderQueue() {
  const search = accountEl('queueSearch').value.trim().toLocaleLowerCase('tr-TR');
  const status = accountEl('queueFilter').value;
  const visible = reviewItems.filter(item => (status === 'all' || item.status === status) && `${item.barcode} ${item.note || ''}`.toLocaleLowerCase('tr-TR').includes(search));
  const list = accountEl('reviewQueue'); list.replaceChildren();
  accountEl('queueCount').textContent = `${visible.length} / ${reviewItems.length} katkı`;
  for (const contribution of visible) {
    const item = textNode('li', '', 'record-card');
    item.append(textNode('h4', contribution.barcode, 'record-title'), textNode('span', STATUS_NAMES[contribution.status], 'badge'),
      textNode('p', `${KIND_NAMES[contribution.kind] || 'Katkı'} · ${readableDate(contribution.created_at)}`, 'muted small'),
      textNode('p', contribution.note || 'Açıklama yok.', 'preserve-lines'));
    const open = textNode('button', 'Katkıyı incele', 'btn btn-secondary'); open.type = 'button';
    open.addEventListener('click', () => openReview(contribution)); item.append(open); list.append(item);
  }
  if (!visible.length) list.append(textNode('li', reviewItems.length ? 'Aramana uygun katkı bulunamadı.' : 'İnceleme bekleyen katkı yok.', 'empty-message'));
}

async function loadAdmin() {
  if (!canReview()) return;
  const generation = ++queueGeneration, session = accountGeneration;
  accountEl('refreshAdminBtn').disabled = true;
  accountEl('adminStatus').textContent = 'Kuyruk yükleniyor…';
  accountEl('reviewDetail').classList.add('hidden'); selectedReview = null;
  reviewItems = []; accountEl('reviewQueue').replaceChildren(); accountEl('queueCount').textContent = '';
  accountEl('budgetSummary').textContent = 'Kullanım yükleniyor…';
  // A summary failure must not hide a usable review queue, or vice versa.
  const results = await Promise.allSettled([accountRequest('/review/queue'), accountRequest('/review/summary')]);
  if (generation !== queueGeneration || session !== accountGeneration || !canReview()) { accountEl('refreshAdminBtn').disabled = false; return; }
  const [queue, summary] = results;
  if (queue.status === 'fulfilled') { reviewItems = queue.value.contributions; renderQueue(); accountEl('adminStatus').textContent = ''; }
  else accountEl('adminStatus').textContent = queue.reason.message;
  const panel = accountEl('budgetSummary'); panel.replaceChildren();
  if (summary.status === 'fulfilled') {
    const budget = summary.value.budget;
    for (const [value, label] of [[`$${Number(budget.dailyUsd).toFixed(2)}`, 'Günlük ortak bütçe'], [`${budget.attemptsUsed} / ${budget.dailyMax}`, 'Kullanılan çağrı'], [budget.attemptsRemaining, 'Kalan çağrı']]) {
      const stat = textNode('div', '', 'stat'); stat.append(textNode('strong', value), textNode('span', label)); panel.append(stat);
    }
  } else panel.append(textNode('p', summary.reason.message));
  accountEl('refreshAdminBtn').disabled = false;
}

function syncReviewFields() {
  const approved = accountEl('reviewDecision').value === 'approved';
  accountEl('verifiedFields').disabled = !approved;
  accountEl('verifiedFields').classList.toggle('hidden', !approved);
  accountEl('submitReviewBtn').textContent = approved ? 'Doğrulanmış ürünü yayınla' : 'İncelemeyi kaydet';
  accountEl('reviewReason').disabled = approved;
  accountEl('reviewReason').closest('form').querySelector('label[for="reviewReason"]').classList.toggle('hidden', approved);
  accountEl('reviewReason').classList.toggle('hidden', approved);
}
function openReview(item) {
  if (!canReview()) return;
  selectedReview = item; accountEl('reviewForm').reset(); syncReviewFields();
  accountEl('reviewStatus').textContent = '';
  accountEl('reviewBarcode').textContent = `${item.barcode} · ${KIND_NAMES[item.kind] || 'Katkı'}`;
  accountEl('reviewNote').textContent = item.note || 'Açıklama yok.';
  accountEl('reviewDetail').classList.remove('hidden');
  accountEl('reviewHeading').focus();
}

function routeAccountPage() {
  const page = currentAccountPage();
  for (const name of ['scan', 'profile', 'admin']) accountEl(`${name}Page`).classList.toggle('hidden', page !== name);
  for (const link of document.querySelectorAll('[data-page]')) {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  document.title = page === 'profile' ? 'Profilim · EatSure' : page === 'admin' ? 'Yönetim · EatSure' : 'EatSure';
  if (page !== 'scan') { stopCameraScan(); accountEl(page === 'profile' ? 'profileHeading' : 'adminHeading').focus(); }
  updateSession();
  if (page === 'profile' && accessToken) loadProfile();
  if (page === 'admin' && canReview()) loadAdmin();
  if (page === 'profile' && !authOptionsLoaded) {
    authOptionsLoaded = true;
    requestJson('/auth/options').then(options => {
      accountEl('sendRecoveryBtn').classList.toggle('hidden', !options.emailRecoveryAvailable);
      if (options.emailRecoveryAvailable) accountEl('recoveryHelp').textContent = 'İlk girişinde veya parolanı unuttuğunda e-posta adresini yazıp “Parola oluştur / sıfırla” düğmesine bas.';
    }).catch(() => { authOptionsLoaded = false; });
  }
}

accountEl('loginForm').addEventListener('submit', async event => {
  event.preventDefault();
  const button = accountEl('loginBtn'); if (button.disabled) return;
  const generation = accountGeneration; button.disabled = true;
  accountEl('sessionStatus').textContent = 'Giriş yapılıyor…';
  try {
    const result = await requestJson('/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: accountEl('emailInput').value.trim(), password: accountEl('passwordInput').value }) });
    if (generation !== accountGeneration) return;
    accessToken = result.accessToken; activationToken = null; passwordSetup = false; clearTimeout(expiryTimer);
    const expiresIn = Number(result.expiresAt) * 1000 - Date.now();
    if (Number.isFinite(expiresIn)) expiryTimer = setTimeout(() => clearAccountSession('Oturum süren doldu. Yeniden giriş yap.'), Math.max(0, Math.min(expiresIn, 2147483647)));
    updateSession(); await loadProfile();
  } catch (error) { if (generation === accountGeneration) accountEl('sessionStatus').textContent = error.message; }
  finally { accountEl('passwordInput').value = ''; button.disabled = false; }
});
accountEl('logoutBtn').addEventListener('click', () => clearAccountSession());
accountEl('reloadProfileBtn').addEventListener('click', loadProfile);
accountEl('loadContributionsBtn').addEventListener('click', loadContributions);
accountEl('profileForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = accountEl('saveProfileBtn'); if (button.disabled) return;
  button.disabled = true; const generation = accountGeneration;
  try {
    const data = await accountRequest('/profile', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ displayName: accountEl('displayNameInput').value.trim() }) });
    if (accountProfile) accountProfile.displayName = data.displayName;
    accountEl('profileStatus').textContent = 'Görünen adın kaydedildi.';
  } catch (error) { if (generation === accountGeneration) accountEl('profileStatus').textContent = error.message; }
  finally { button.disabled = false; }
});
accountEl('refreshAdminBtn').addEventListener('click', loadAdmin);
accountEl('queueSearch').addEventListener('input', renderQueue);
accountEl('queueFilter').addEventListener('change', renderQueue);
accountEl('reviewDecision').addEventListener('change', syncReviewFields);
accountEl('closeReviewBtn').addEventListener('click', () => { selectedReview = null; accountEl('reviewDetail').classList.add('hidden'); });
accountEl('reviewForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = accountEl('submitReviewBtn');
  if (button.disabled || !selectedReview || !canReview()) return;
  const item = selectedReview, session = accountGeneration;
  const body = { status: accountEl('reviewDecision').value, note: accountEl('reviewDecision').value === 'approved' ? 'Etiket ve kaynak bağımsız olarak doğrulandı.' : accountEl('reviewReason').value.trim() };
  if (body.status === 'approved') body.verifiedLabel = { barcode: item.barcode, name: accountEl('verifiedName').value.trim(), brand: accountEl('verifiedBrand').value.trim(), sourceUrl: accountEl('verifiedSource').value.trim(), labelText: accountEl('verifiedLabel').value, evidenceChecked: accountEl('evidenceChecked').checked };
  button.disabled = true; accountEl('reviewStatus').textContent = 'İnceleme kaydediliyor…';
  try {
    await accountRequest(`/review/${encodeURIComponent(item.id)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    accountEl('reviewForm').reset(); accountEl('reviewDetail').classList.add('hidden'); selectedReview = null;
    await loadAdmin();
    if (session === accountGeneration && canReview()) accountEl('adminStatus').textContent = `${item.barcode}: ${STATUS_NAMES[body.status]}.`;
  } catch (error) {
    if (session !== accountGeneration || !canReview()) return;
    const messages = { INSUFFICIENT_VERIFIED_EVIDENCE: 'Etiket metninde yeterli içindekiler bilgisi bulunamadı. Metni kontrol et.', VERIFIED_EVIDENCE_REQUIRED: 'Ürün adı, marka, kaynak, etiket metni ve doğrulama onayı gerekli.', REVIEW_CONFLICT: 'Bu katkı değişmiş, geri çekilmiş veya süresi dolmuş olabilir. Kuyruğu yenileyip tekrar kontrol et.', INVALID_SOURCE_URL: 'Geçerli bir HTTPS kaynak bağlantısı gir.' };
    accountEl('reviewStatus').textContent = messages[error.code] || error.message;
  } finally { button.disabled = false; }
});

accountEl('sendRecoveryBtn').addEventListener('click', async () => {
  const email = accountEl('emailInput'); if (!email.reportValidity()) return;
  const button = accountEl('sendRecoveryBtn'); if (button.disabled) return;
  button.disabled = true; const generation = accountGeneration;
  accountEl('sessionStatus').textContent = 'Bağlantı isteniyor…';
  try {
    const data = await requestJson('/auth/recovery', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.value.trim() }) });
    if (generation === accountGeneration) accountEl('sessionStatus').textContent = data.message;
  } catch (error) { if (generation === accountGeneration) accountEl('sessionStatus').textContent = error.message; }
  finally { button.disabled = false; }
});
accountEl('passwordSetupForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = accountEl('savePasswordBtn'); if (button.disabled) return;
  if (accountEl('newPasswordInput').value !== accountEl('confirmPasswordInput').value) { accountEl('passwordStatus').textContent = 'Parolalar eşleşmiyor.'; return; }
  button.disabled = true; const generation = accountGeneration;
  try {
    const result = await accountRequest('/auth/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: accountEl('newPasswordInput').value }) });
    clearAccountSession(result.message);
  } catch (error) { if (generation === accountGeneration) accountEl('passwordStatus').textContent = error.message; }
  finally { accountEl('passwordSetupForm').reset(); button.disabled = false; }
});
accountEl('activateAccountBtn').addEventListener('click', async () => {
  const button = accountEl('activateAccountBtn');
  if (!activationToken || button.disabled) return;
  button.disabled = true; const generation = accountGeneration;
  accountEl('activationStatus').textContent = 'Bağlantı doğrulanıyor…';
  try {
    const result = await requestJson('/auth/activate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(activationToken) });
    if (generation !== accountGeneration) return;
    activationToken = null; accessToken = result.accessToken; passwordSetup = true;
    const remaining = Number(result.expiresAt) * 1000 - Date.now();
    clearTimeout(expiryTimer);
    expiryTimer = setTimeout(() => clearAccountSession('Oturum süren doldu. Yeni bir bağlantı iste.'), Number.isFinite(remaining) ? Math.max(0, Math.min(remaining, 3600000)) : 3600000);
    updateSession(); await loadProfile(); accountEl('newPasswordInput').focus();
  } catch (error) { if (generation === accountGeneration) accountEl('activationStatus').textContent = error.message; }
  finally { button.disabled = false; }
});

// Supabase recovery links carry a short-lived token in the fragment. Remove it
// from the address immediately; no token is written to persistent browser storage.
function handleAccountLocation() {
  const recoveryParams = new URLSearchParams(location.hash.slice(1));
  if (recoveryParams.has('access_token') || recoveryParams.has('token_hash') || recoveryParams.has('error') || recoveryParams.has('error_code')) {
    history.replaceState(null, '', `${location.pathname}${location.search}#profil`);
    clearAccountSession();
    if (['recovery', 'invite'].includes(recoveryParams.get('type')) && /^[a-f0-9]{64}$/i.test(recoveryParams.get('token_hash') || '')) {
      activationToken = { tokenHash: recoveryParams.get('token_hash'), type: recoveryParams.get('type') };
      routeAccountPage();
    } else if (['recovery', 'invite'].includes(recoveryParams.get('type')) && recoveryParams.get('access_token')) {
      accessToken = recoveryParams.get('access_token'); passwordSetup = true;
      const seconds = Number(recoveryParams.get('expires_in'));
      expiryTimer = setTimeout(() => clearAccountSession('Bağlantının süresi doldu. Yeni bir parola bağlantısı iste.'), Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds * 1000, 3600000) : 3600000);
      routeAccountPage();
    } else { routeAccountPage(); accountEl('sessionStatus').textContent = 'Bağlantı geçersiz veya süresi dolmuş. Yeni bir parola bağlantısı iste.'; }
  } else routeAccountPage();
}
window.addEventListener('hashchange', handleAccountLocation);
handleAccountLocation();
