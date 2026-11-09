// Account state stays in this tab. Authorization always comes from the server.
const accountEl = id => document.getElementById(id);
const STATUS_NAMES = { pending: 'İnceleme bekliyor', needs_more_info: 'Ek bilgi bekliyor', rejected: 'Reddedildi', approved: 'Onaylandı', withdrawn: 'Geri çekildi', expired: 'Süresi doldu' };
const KIND_NAMES = { decision_dispute: 'Sonuca itiraz', label_correction: 'Etiket düzeltme', new_product: 'Yeni ürün' };
const ROLE_NAMES = { user: 'Kullanıcı', reviewer: 'İncelemeci', admin: 'Admin' };
let accountProfile = null;
let accountGeneration = 0;
let expiryTimer = null;
let reviewItems = [];
let queueRequestGeneration = 0;
const reviewQueueState = { page: 1, pageSize: 50, status: 'open', q: '', total: 0, totalPages: 0 };
let activeReviewClaim = false;
let selectedReview = null;
let queueGeneration = 0;
let historyGeneration = 0;
let reviewMediaGeneration = 0;
let reviewAccessGeneration = 0;
let passwordSetup = false;
let authOptionsLoaded = false;
let activationToken = null;

function textNode(tag, text, className = '') {
  const node = document.createElement(tag); node.textContent = text; node.className = className; return node;
}
function readableDate(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('tr-TR') : 'Belirtilmemiş';
}
function verifiedLabelForm(barcode) {
  return { barcode, name: accountEl('verifiedName').value.trim(), brand: accountEl('verifiedBrand').value.trim(),
    sourceUrl: accountEl('verifiedSource').value.trim(), labelText: accountEl('verifiedLabel').value,
    evidenceChecked: accountEl('evidenceChecked').checked, evidenceKind: accountEl('verifiedEvidenceKind').value || null,
    observedOn: accountEl('verifiedObservedOn').value || null, labelDate: accountEl('verifiedLabelDate').value || null };
}

function appendSourceHistory(box, detail) {
  const source = detail.source;
  if (source) {
    const kind = evidenceNames[source.evidence_kind] || evidenceNames.legacy_unknown;
    const dates = [[source.observed_at, 'Gözlem', true], [source.label_date, 'Etiket veya belge', true],
      [source.reviewed_at, 'İnsan incelemesi', false]]
      .map(([value, label, day]) => `${label}: ${evidenceDate(value, day) || 'Belirtilmemiş'}`);
    box.append(textNode('p', [kind, source.source_ref, ...dates].filter(Boolean).join(' · ')));
  }
  const results = detail.publishedAnalyses || [];
  if (!results.length) return;
  const history = document.createElement('details');
  history.append(textNode('summary', 'Karar hesaplama geçmişi'));
  const reasons = { rules_changed: 'Kural değişikliği', cache_expired: 'Cache süresi doldu', certificate_recheck: 'Sertifika yeniden kontrolü' };
  for (const row of results) {
    const versions = [row.analyzer_version, row.decision_engine_version, row.visual_policy_version, row.certificate_data_version];
    history.append(textNode('p', [evidenceDate(row.evaluated_at), row.decision_level, reasons[row.reevaluation_reason],
      row.product_version_id && `Paket ${row.product_version_id}`, row.id && `Karar ${row.id}`,
      row.previous_analysis_id && `Önceki karar ${row.previous_analysis_id}`, versions.filter(Boolean).join(' / ')].filter(Boolean).join(' · ')));
  }
  box.append(history);
}

function canReview() { return Boolean(accessToken && ['admin', 'reviewer'].includes(accountProfile?.role)); }
function currentAccountPage() { return location.hash === '#admin' ? 'admin' : location.hash === '#profil' ? 'profile' : 'scan'; }

function updateSession() {
  const signedIn = Boolean(accessToken);
  accountEl('authChoice').classList.toggle('hidden',signedIn||Boolean(activationToken));
  accountEl('sessionStatus').textContent = activationToken ? 'İlk giriş için aşağıdaki bağlantıyı doğrula ve parolanı belirle.' : signedIn ? 'Oturum açık.' : 'Mevcut EatSure hesabınla giriş yap.';
  accountEl('loginForm').classList.toggle('hidden', signedIn || Boolean(activationToken) || accountEl('authChoice').classList.contains('hidden')===false);
  accountEl('logoutBtn').classList.toggle('hidden', !signedIn);
  accountEl('profileContent').classList.toggle('hidden', !signedIn || !accountProfile); accountEl('roleChoice').classList.toggle('hidden',!signedIn||!accountProfile||!canReview());
  accountEl('reloadProfileBtn').classList.toggle('hidden', !signedIn || Boolean(accountProfile));
  accountEl('passwordSetup').classList.toggle('hidden', !signedIn || !passwordSetup);
  accountEl('activationCard').classList.toggle('hidden', !activationToken);
  accountEl('adminGate').classList.toggle('hidden', canReview());
  accountEl('adminContent').classList.toggle('hidden', !canReview());
  accountEl('adminGateMessage').textContent = !signedIn ? 'Yönetim alanına erişmek için yetkili hesabınla giriş yap.' :
    !accountProfile ? 'Yönetim yetkisi henüz doğrulanamadı. Profil sayfasından yeniden deneyebilirsin.' : 'Bu hesabın yönetim yetkisi yok. Kendi katkılarını Profilim sayfasından takip edebilirsin.';
}

function clearReviewDetail() {
  reviewMediaGeneration++;
  selectedReview = null;
  activeReviewClaim = false;
  activeReviewPreview = null;
  closeReviewImage();
  for (const id of ['reviewBarcode', 'reviewContext', 'reviewNote', 'reviewClaimStatus', 'reviewStructuredFields',
    'reviewPriorProduct', 'reviewPreview', 'reviewMedia', 'reviewStatus']) accountEl(id).replaceChildren();
  accountEl('reviewForm').reset();
  for (const id of ['reviewDetail', 'reviewPreview', 'releaseReviewBtn']) accountEl(id).classList.add('hidden');
}

function clearReviewAccess() {
  reviewAccessGeneration++;
  queueGeneration++;
  queueRequestGeneration++;
  reviewItems = [];
  clearReviewDetail();
  for (const id of ['reviewQueue', 'budgetSummary', 'accountRequests', 'queueCount', 'adminStatus']) accountEl(id).replaceChildren();
}

function clearAccountSession(message) {
  activePhotoRequest?.abort();
  stopCameraScan();
  clearProductLookupSlowTimer();
  resetPhotoSelection();
  clearContributionPhotos(false);
  currentContributionContext = null;
  contributionAttempt = null;
  setBackendResult('Henüz sonuç yok.');
  hideRetry();
  barcodeInputEl.value = '';
  ocrTextEl.value = '';
  userResultEl.replaceChildren();
  userStatusEl.replaceChildren();
  for (const id of ['scanAnnouncement', 'contributionContextLabel', 'photoQuotaNotice']) accountEl(id).textContent = '';
  for (const id of ['photoSection', 'resultSection', 'statusSection']) accountEl(id).classList.add('hidden');
  accountGeneration++; historyGeneration++;
  clearTimeout(expiryTimer); accessToken = null; accountProfile = null;
  clearReviewAccess();
  passwordSetup = false; accountEl('passwordSetupForm').reset(); accountEl('passwordStatus').textContent = '';
  activationToken = null; accountEl('activationStatus').textContent = '';
  for (const id of ['profileEmail', 'profileCreated', 'profileVerified', 'profileRole', 'contributionHistory', 'profileStatus', 'contributionStatus']) accountEl(id).replaceChildren();
  for (const id of ['loginForm', 'profileForm', 'contributionForm']) accountEl(id).reset();
  updateContributionKindFields();
  updateSession();
  if (message) accountEl('sessionStatus').textContent = message;
}

async function accountRequest(path, options = {}, timeoutMs) {
  const token = accessToken, generation = accountGeneration;
  const reviewGeneration = reviewAccessGeneration;
  if (!token) throw new Error('Önce hesabına giriş yap.');
  try {
    const data = await requestJson(path, { ...options, headers: { ...options.headers, Authorization: `Bearer ${token}` } }, timeoutMs);
    if (generation !== accountGeneration || token !== accessToken) throw new Error('Oturum değişti. Yeniden giriş yap.');
    if (path.startsWith('/review/') && reviewGeneration !== reviewAccessGeneration) throw new Error('İnceleme yetkisi değişti.');
    return data;
  } catch (error) {
    if (error.status === 403 && generation === accountGeneration && reviewGeneration === reviewAccessGeneration) {
      // Clear previously displayed privileged data immediately after a role revocation.
      accountProfile = null;
      clearReviewAccess();
      updateSession();
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
    if (canReview() && !['admin', 'reviewer'].includes(profile.role)) clearReviewAccess();
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
      if (contribution.activity_at && (!contribution.owner_read_at || contribution.activity_at > contribution.owner_read_at)) item.append(textNode('p', 'Yeni durum bildirimi: ' + (STATUS_NAMES[contribution.status] || ''), 'feedback'));
      const detail = textNode('button', 'Detay ve işlem geçmişi', 'btn btn-secondary btn-small'); detail.type = 'button';
      detail.addEventListener('click', () => openContributionDetail(contribution, item, generation)); item.append(detail);
      const isOpen = ['pending', 'needs_more_info'].includes(contribution.status);
      const remove = textNode('button', isOpen ? 'Katkıyı geri çek ve açıklamayı sil' : 'Kişisel açıklamayı sil', 'btn btn-secondary btn-small');
      remove.type = 'button';
      remove.addEventListener('click', async () => {
        const confirmText = isOpen
          ? 'Katkı geri çekilecek; kişisel açıklaman ve hesap bağlantın silinecek. İşlem kaydı korunacak. Devam edilsin mi?'
          : 'Kişisel açıklaman ve hesap bağlantın silinecek. Onaylanmış ürün kaydı ve inceleme geçmişi korunacak. Devam edilsin mi?';
        if (!window.confirm(confirmText)) return;
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
  const list = accountEl('reviewQueue'); list.replaceChildren();
  accountEl('queueCount').textContent = `${reviewQueueState.total} katkı · ${reviewQueueState.totalPages ? `sayfa ${reviewQueueState.page}/${reviewQueueState.totalPages}` : 'sonuç yok'}`;
  const groups=new Map();for(const contribution of reviewItems){const key=contribution.barcode;const rows=groups.get(key)||[];rows.push(contribution);groups.set(key,rows);}
  for (const [barcode,contributions] of groups) {
    const group=textNode('li','','record-card');group.append(textNode('h4',`${barcode} · ${contributions.length} katkı bu sayfada`,'record-title'));
    for(const contribution of contributions){
      const row=textNode('section','','review-queue-entry');
      row.append(textNode('span',STATUS_NAMES[contribution.status]||contribution.status,'badge'),textNode('p',`${KIND_NAMES[contribution.kind]||'Katkı'} · ${readableDate(contribution.created_at)}`,'muted small'));
      if(contribution.note)row.append(textNode('p',contribution.note,'preserve-lines'));
      const created=Date.parse(contribution.created_at),activity=Date.parse(contribution.activity_at||contribution.created_at);
      if(contribution.status==='pending'&&activity>created+1000)row.append(textNode('span','Yeni kullanıcı yanıtı','badge badge-info'));
      if(contribution.status==='pending'&&Number.isFinite(activity)&&Date.now()-activity>=48*60*60*1000)row.append(textNode('span','48 saati aşkın süredir inceleme bekliyor','badge badge-warning'));
      if(contribution.claimed_by&&Date.now()-Date.parse(contribution.claimed_at)<30*60*1000)row.append(textNode('p',contribution.claimed_by===accountProfile?.id?'İncelemeyi sen üstlendin':'Başka bir incelemeci üstlendi','muted small'));
      const open=textNode('button','Katkıyı incele','btn btn-secondary');open.type='button';open.addEventListener('click',()=>openReview(contribution));row.append(open);group.append(row);
    }
    list.append(group);
  }
  if (!reviewItems.length) list.append(textNode('li', reviewQueueState.total ? 'Bu sayfada kayıt yok.' : 'Bu filtreyle kayıt bulunamadı.','empty-message'));
  accountEl('queuePreviousBtn').disabled=reviewQueueState.page<=1;
  accountEl('queueNextBtn').disabled=reviewQueueState.page>=reviewQueueState.totalPages;
}

async function loadReviewQueue(){
  if(!canReview())return;const generation=++queueRequestGeneration,session=accountGeneration;
  accountEl('adminStatus').textContent='İnceleme kayıtları yükleniyor…';
  const params=new URLSearchParams({page:String(reviewQueueState.page),pageSize:String(reviewQueueState.pageSize),status:reviewQueueState.status,q:reviewQueueState.q});
  try{const result=await accountRequest('/review/queue?'+params);if(generation!==queueRequestGeneration||session!==accountGeneration||!canReview())return;reviewItems=result.contributions;reviewQueueState.total=Number.isInteger(result.total)?result.total:reviewItems.length;reviewQueueState.totalPages=Number.isInteger(result.totalPages)?result.totalPages:Math.ceil(reviewQueueState.total/reviewQueueState.pageSize);renderQueue();accountEl('adminStatus').textContent='';}
  catch(error){if(generation===queueRequestGeneration&&session===accountGeneration)accountEl('adminStatus').textContent=error.message;}
}

async function loadAdmin() {
  if (!canReview()) return;
  const generation = ++queueGeneration, session = accountGeneration;
  accountEl('refreshAdminBtn').disabled = true;
  accountEl('adminStatus').textContent = 'Kuyruk yükleniyor…';
  clearReviewDetail();
  queueRequestGeneration++;reviewItems = []; accountEl('reviewQueue').replaceChildren(); accountEl('queueCount').textContent = '';
  accountEl('budgetSummary').textContent = 'Kullanım yükleniyor…';
  // A summary failure must not hide a usable review queue, or vice versa.
  const results = await Promise.allSettled([loadReviewQueue(), accountRequest('/review/summary'),loadAccountRequests()]);
  if (generation !== queueGeneration || session !== accountGeneration || !canReview()) { accountEl('refreshAdminBtn').disabled = false; return; }
  const [, summary] = results;
  const panel = accountEl('budgetSummary'); panel.replaceChildren();
  if (summary.status === 'fulfilled') {
    const budget = summary.value.budget;
    const reported = budget.providerCosts?.length ? budget.providerCosts.map(row => `${row.provider} $${Number(row.usd).toFixed(4)}`).join(' · ') : 'Bekleniyor';
    for (const [value, label] of [[`$${Number(budget.dailyUsd).toFixed(2)}`, 'Günlük ortak bütçe'], [`${budget.attemptsUsed} / ${budget.dailyMax}`, 'Bütçeden düşen çağrı'], [budget.reservedPending ?? '—', 'Bekleyen rezervasyon'], [budget.photoDispatches ?? '—', 'Gönderim kaydı olan fotoğraf çağrısı'], [budget.attemptsRemaining, 'Kalan çağrı'], [reported, 'Sağlayıcının bildirdiği maliyet']]) {
      const stat = textNode('div', '', 'stat'); stat.append(textNode('strong', value), textNode('span', label)); panel.append(stat);
    }
  } else panel.append(textNode('p', summary.reason.message));
  accountEl('refreshAdminBtn').disabled = false;
}

let activeReviewPreview=null;
function syncReviewFields() {
  const approved = accountEl('reviewDecision').value === 'approved';
  accountEl('verifiedFields').disabled = !approved||!activeReviewClaim;
  accountEl('verifiedFields').classList.toggle('hidden', !approved);
  accountEl('submitReviewBtn').textContent = approved ? 'Doğrulanmış ürünü yayınla' : 'İncelemeyi kaydet';
  accountEl('reviewDecision').disabled=!activeReviewClaim;
  accountEl('reviewReason').disabled = approved||!activeReviewClaim;
  accountEl('reviewReason').closest('form').querySelector('label[for="reviewReason"]').classList.toggle('hidden', approved);
  accountEl('reviewReason').classList.toggle('hidden', approved);accountEl('previewReviewBtn').disabled=!activeReviewClaim;accountEl('submitReviewBtn').disabled=!activeReviewClaim||(approved&&!activeReviewPreview);accountEl('reviewPreview').classList.add('hidden');
}
function openReview(item) {
  if (!canReview()) return;
  const priorReview=selectedReview;if(priorReview&&activeReviewClaim&&priorReview.id!==item.id)accountRequest('/review/'+encodeURIComponent(priorReview.id)+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release'})}).catch(()=>{});
  clearReviewDetail();
  selectedReview = item; syncReviewFields();
  accountEl('reviewClaimStatus').textContent='İnceleme üstleniliyor…';accountEl('releaseReviewBtn').classList.add('hidden');
  accountEl('reviewStatus').textContent = '';
  accountEl('reviewBarcode').textContent = `${item.barcode} · ${KIND_NAMES[item.kind] || 'Katkı'}`;
  accountEl('reviewContext').textContent = item.context_product_version_id
    ? `Bağlı ürün sürümü #${item.context_product_version_no || '?'} (${item.context_product_version_id}) · analiz: ${item.context_analysis_result_id || 'yok'} · karar: ${item.context_decision_level || 'belirtilmemiş'}`
    : `Bağlı sunucu sonucu (${item.context_source || 'tarama'}): ${(item.context_fingerprint || 'mevcut').slice(0, 12)} · karar: ${item.context_decision_level || 'belirtilmemiş'}`;
  accountEl('reviewNote').textContent = item.note || 'Açıklama yok.';
  const reviewSession = accountGeneration;
  accountRequest('/contributions/' + encodeURIComponent(item.id) + '/events').then(({events}) => {
    if (reviewSession !== accountGeneration || selectedReview?.id !== item.id) return;
    for (const entry of events || []) if (entry.reason_text) accountEl('reviewNote').append(textNode('p', readableDate(entry.created_at) + ' · ' + (entry.action === 'user_replied' ? 'Kullanıcı yanıtı: ' : 'İnceleme: ') + entry.reason_text, 'preserve-lines'));
  }).catch(() => {});
  const fieldLabels = { productName: 'Gönderilen ürün adı', brand: 'Gönderilen marka', currentValue: 'Mevcut bilgi', proposedValue: 'Önerilen bilgi', errorType: 'İtiraz türü' };
  const errorLabels = { wrong_product: 'Ürün eşleşmesi yanlış', wrong_gluten_decision: 'Gluten kararı yanlış', missing_ingredient_evidence: 'İçindekiler kanıtı eksik', allergen_or_trace: 'Alerjen veya çapraz bulaşma', other: 'Diğer' };
  const structured = item.structured_fields || {};
  accountEl('reviewStructuredFields').replaceChildren();
  for (const [key, label] of Object.entries(fieldLabels)) if (typeof structured[key] === 'string' && structured[key]) {
    const row = document.createElement('p'); const heading = document.createElement('strong'); heading.textContent = `${label}: `;
    const value = document.createElement('span'); value.textContent = key === 'errorType' ? errorLabels[structured[key]] || 'Bilinmeyen tür' : structured[key]; row.append(heading, value); accountEl('reviewStructuredFields').append(row);
  }
  accountEl('verifiedName').value = structured.productName || '';
  accountEl('verifiedBrand').value = structured.brand || '';
  for (const id of ['verifiedEvidenceKind', 'verifiedObservedOn', 'verifiedLabelDate']) accountEl(id).value = '';
  loadReviewMedia(item);
  accountEl('reviewDetail').classList.remove('hidden');
  accountEl('reviewPriorProduct').textContent = 'Ürün/sürüm/karar/etiket ve işlem geçmişi yükleniyor…';
  accountRequest('/review/'+encodeURIComponent(item.id)+'/detail').then(detail=>{if(selectedReview?.id!==item.id)return;const box=accountEl('reviewPriorProduct');box.replaceChildren();const v=detail.version,d=detail.analysis;if(detail.product)box.append(textNode('p','Mevcut ürün: '+detail.product.barcode));if(v){box.append(textNode('h4','Sürüm '+v.version_no+' · '+(v.is_current?'etkin':'geçmiş')+' · '+v.version_status+' · '+readableDate(v.created_at)),textNode('p','Ad: '+(v.product_name_text||'Bilinmiyor')+' · Marka: '+(v.brand_text||'Bilinmiyor')),textNode('p','İçindekiler: '+(v.ingredients_text||'Belirtilmemiş')),textNode('p','Alerjenler: '+(v.allergens_text||'Belirtilmemiş')+' · İzler: '+(v.traces_text||'Belirtilmemiş')),textNode('p','Beyanlar: '+(v.labels_text||'Belirtilmemiş')),textNode('p','Ham etiket: '+(v.raw_label_text||'Belirtilmemiş'),'preserve-lines'));}if(detail.publishedVersions?.length){box.append(textNode('h4','İşlem geçmişindeki ürün sürümleri'));for(const published of detail.publishedVersions){const card=document.createElement('details'),summary=textNode('summary',`Sürüm ${published.version_no} · ${published.version_status} · ${published.product_name_text||'Ad yok'} · ${readableDate(published.created_at)}`);card.append(summary,textNode('p','Ürün sürümü kimliği: '+published.id),textNode('p','Marka: '+(published.brand_text||'Belirtilmemiş')),textNode('p','İçindekiler: '+(published.ingredients_text||'Belirtilmemiş'),'preserve-lines'),textNode('p','Alerjenler: '+(published.allergens_text||'Belirtilmemiş')+' · İzler: '+(published.traces_text||'Belirtilmemiş'),'preserve-lines'),textNode('p','Beyanlar: '+(published.labels_text||'Belirtilmemiş'),'preserve-lines'),textNode('p','Kaynak kaydı: '+(published.source_record_id||'yok')));const savedDecision=(detail.publishedAnalyses||[]).find(result=>result.product_version_id===published.id&&!result.previous_analysis_id);if(savedDecision)card.append(textNode('p','Yayın kararı: '+savedDecision.decision_level+' · '+(savedDecision.decision_reason||'')),textNode('p','Kanıt: '+JSON.stringify(savedDecision.evidence_json||[])));box.append(card);}}if(d)box.append(textNode('p','Önceki karar: '+d.decision_level+' · '+(d.decision_reason||'')),textNode('p','Karar kanıtı: '+JSON.stringify(d.evidence_json||[])));else if(!detail.publishedVersions?.length)box.append(textNode('p','Bu barkod için önceden yayınlanmış ürün sürümü yok.'));appendSourceHistory(box,detail);if(detail.productContributions?.length){box.append(textNode('h4','Aynı ürüne ait diğer katkılar'));for(const other of detail.productContributions){const row=textNode('div',`${STATUS_NAMES[other.status]||other.status} · ${KIND_NAMES[other.kind]||'Katkı'} · ${readableDate(other.created_at)}`,'record-card');row.append(textNode('p',other.review_note||''));const jump=textNode('button','Bu katkıyı aç','btn btn-secondary btn-small');jump.type='button';jump.addEventListener('click',()=>{const found=reviewItems.find(entry=>entry.id===other.id)||other;openReview(found);});row.append(jump);box.append(row);}}for(const ev of detail.events||[]){box.append(textNode('p',readableDate(ev.created_at)+' · '+ev.action+' · '+(ev.reason_code||'gerekçe yok')+(ev.product_version_id?' · yayın sürümü '+ev.product_version_id:''),'preserve-lines'));if(ev.reason_text)box.append(textNode('p',ev.reason_text,'preserve-lines'));}}).catch(()=>{if(selectedReview?.id===item.id)accountEl('reviewPriorProduct').textContent='Ürün geçmişi şu anda açılamıyor.';});
  accountRequest('/review/'+encodeURIComponent(item.id)+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'claim'})}).then(()=>{if(selectedReview?.id!==item.id)return;activeReviewClaim=true;accountEl('reviewClaimStatus').textContent='Bu incelemeyi 30 dakika boyunca sen üstlendin.';accountEl('releaseReviewBtn').classList.remove('hidden');syncReviewFields();}).catch(()=>{if(selectedReview?.id!==item.id)return;accountEl('reviewClaimStatus').textContent='Başka bir incelemeci üstlenmiş, kayıt kapanmış veya süre dolmuş. Detayı okuyabilirsin; işlem yapamazsın.';});
  accountEl('reviewHeading').focus();
}

async function loadReviewMedia(item) {
  const generation = ++reviewMediaGeneration, container = accountEl('reviewMedia');
  container.replaceChildren();
  try {
    const { media } = await accountRequest(`/contributions/${encodeURIComponent(item.id)}/media`);
    if (generation !== reviewMediaGeneration || selectedReview?.id !== item.id) return;
    const labels = { front_label: 'Ürün ön yüzü', ingredients_panel: 'İçindekiler / alerjen yüzü', extra: 'Ek fotoğraf' };
    for (const photo of media || []) {
      const card = document.createElement('figure'); card.className = 'contribution-photo-card';
      const label = labels[photo.role] || 'Katkı fotoğrafı';
      const image = document.createElement('img'); image.referrerPolicy = 'no-referrer'; image.alt = label; image.src = photo.url;
      const caption = textNode('figcaption', label);
      const enlarge = textNode('button', label + ' fotoğrafını büyüt', 'btn btn-secondary btn-small');
      enlarge.type = 'button';
      enlarge.addEventListener('click', () => {
        if (!canReview() || generation !== reviewMediaGeneration || selectedReview?.id !== item.id) return;
        accountEl('reviewImageTitle').textContent = label;
        accountEl('reviewImageContent').replaceChildren(image.cloneNode());
        accountEl('reviewImageDialog').showModal();
      });
      image.addEventListener('error', () => {
        if (generation !== reviewMediaGeneration || !card.isConnected) return;
        enlarge.disabled = true;
        caption.textContent = label + ' açılamadı. Bağlantıyı yenilemek için fotoğrafları yeniden yükle.';
      });
      card.append(image, caption, enlarge); container.append(card);
    }
    if (media?.length) addReviewMediaRetry(container, item, generation);
    if (!media?.length) container.textContent = 'Bu katkıya bağlı saklanan fotoğraf yok.';
  } catch {
    if (generation === reviewMediaGeneration && selectedReview?.id === item.id) {
      container.textContent = 'Fotoğraflar şu anda açılamıyor.';
      addReviewMediaRetry(container, item, generation);
    }
  }
}

function addReviewMediaRetry(container, item, generation) {
  const retry = textNode('button', 'Fotoğrafları yeniden yükle', 'btn btn-secondary btn-small');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    if (canReview() && generation === reviewMediaGeneration && selectedReview?.id === item.id) loadReviewMedia(item);
  });
  container.append(retry);
}

function closeReviewImage() {
  const dialog = accountEl('reviewImageDialog');
  if (dialog.open) dialog.close();
  accountEl('reviewImageContent').replaceChildren();
  accountEl('reviewImageTitle').textContent = 'Katkı fotoğrafı';
}
accountEl('reviewImageDialog').addEventListener('close', () => {
  if (!accountEl('reviewImageDialog').open) closeReviewImage();
});

function routeAccountPage() {
  const page = currentAccountPage();
  for (const name of ['scan', 'profile', 'admin']) accountEl(`${name}Page`).classList.toggle('hidden', page !== name);
  for (const link of document.querySelectorAll('[data-page]')) {
    if (link.dataset.page === page) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  }
  document.title = page === 'profile' ? 'Profilim · EatSure' : page === 'admin' ? 'Yönetim · EatSure' : 'EatSure';
  if (page !== 'scan') { stopCameraScan(); accountEl(page === 'profile' ? 'profileHeading' : 'adminHeading').focus(); }
  if (page !== 'admin') closeReviewImage();
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
accountEl('logoutBtn').addEventListener('click', () => {
  clearAccountSession('Oturum kapatıldı.');
  accountEl('showLoginBtn').focus();
});
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
let queueSearchTimer=null;accountEl('queueSearch').addEventListener('input',()=>{clearTimeout(queueSearchTimer);reviewQueueState.q=accountEl('queueSearch').value;reviewQueueState.page=1;queueSearchTimer=setTimeout(loadReviewQueue,300);});
accountEl('queueFilter').addEventListener('change',()=>{reviewQueueState.status=accountEl('queueFilter').value;reviewQueueState.page=1;loadReviewQueue();});
accountEl('queuePreviousBtn').addEventListener('click',()=>{if(reviewQueueState.page>1){reviewQueueState.page--;loadReviewQueue();}});
accountEl('queueNextBtn').addEventListener('click',()=>{if(reviewQueueState.page<reviewQueueState.totalPages){reviewQueueState.page++;loadReviewQueue();}});
accountEl('reviewDecision').addEventListener('change', syncReviewFields);
accountEl('closeReviewBtn').addEventListener('click', () => {
  const item = selectedReview;
  if (item && activeReviewClaim) accountRequest('/review/' + encodeURIComponent(item.id) + '/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'release' })
  }).catch(() => {});
  clearReviewDetail();
  (accountEl('reviewQueue').querySelector('button') || accountEl('adminHeading')).focus();
});
accountEl('releaseReviewBtn').addEventListener('click',async()=>{const item=selectedReview;if(!item||!activeReviewClaim)return;try{await accountRequest('/review/'+encodeURIComponent(item.id)+'/claim',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'release'})});activeReviewClaim=false;activeReviewPreview=null;accountEl('reviewClaimStatus').textContent='İnceleme kuyruğa bırakıldı.';accountEl('releaseReviewBtn').classList.add('hidden');syncReviewFields();}catch(error){accountEl('reviewClaimStatus').textContent=error.message;}});
accountEl('reviewForm').addEventListener('submit', async event => {
  event.preventDefault(); const button = accountEl('submitReviewBtn');
  if (button.disabled || !selectedReview || !canReview()) return;
  const item = selectedReview, session = accountGeneration;
  const body = { status: accountEl('reviewDecision').value, previewId: activeReviewPreview, note: accountEl('reviewDecision').value === 'approved' ? 'Etiket ve kaynak bağımsız olarak doğrulandı.' : accountEl('reviewReason').value.trim() };
  if (body.status === 'approved') body.verifiedLabel = verifiedLabelForm(item.barcode);
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
    if (['recovery', 'invite'].includes(recoveryParams.get('type')) && /^(?:[a-f0-9]{56}|[a-f0-9]{64})$/i.test(recoveryParams.get('token_hash') || '')) {
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
window.addEventListener('pagehide', event => {
  if (event.persisted) clearAccountSession('Devam etmek için yeniden giriş yap.');
});
handleAccountLocation();

async function openContributionDetail(contribution, card, generation) {
  const session = accountGeneration;
  card.querySelector('.contribution-thread')?.remove();
  const panel = textNode('section', 'Detaylar yükleniyor…', 'contribution-thread'); card.append(panel);
  const alive = () => session === accountGeneration && generation === historyGeneration && panel.isConnected;
  try {
    const base = '/contributions/' + encodeURIComponent(contribution.id);
    const [detail, history, photos] = await Promise.all([accountRequest(base + '/detail'), accountRequest(base + '/events'), accountRequest(base + '/media')]);
    if (!alive()) return;
    panel.replaceChildren(); const item = detail.contribution;
    panel.append(textNode('h4', STATUS_NAMES[item.status] || item.status), textNode('p', item.note || 'Kişisel açıklama saklanmıyor.', 'preserve-lines'));
    for (const [key,value] of Object.entries(item.structured_fields || {})) panel.append(textNode('p', key + ': ' + value));
    const actions = {submitted:'Katkı gönderildi',needs_more_info:'Ek bilgi istendi',user_replied:'Kullanıcı yanıtı',approved:'Kayıt onaylandı',rejected:'Reddedildi',withdrawn:'Geri çekildi',expired:'Süre doldu',personal_data_erased:'Kişisel bilgiler silindi'};
    for (const entry of history.events || []) panel.append(textNode('p', readableDate(entry.created_at) + ' · ' + (actions[entry.action] || entry.action) + (entry.reason_text ? ': ' + entry.reason_text : ''), 'preserve-lines'));
    for (const photo of photos.media || []) { const img = document.createElement('img'); img.src=photo.url; img.alt='Katkı kanıtı'; img.style.maxWidth='100%'; img.referrerPolicy='no-referrer'; panel.append(textNode('p', photo.replyEventId ? 'Yanıta eklenen kanıt · ' + readableDate((history.events || []).find(e=>e.id===photo.replyEventId)?.created_at) : 'İlk katkıya eklenen kanıt'), img); }
    if (item.activity_at) accountRequest(base + '/read', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({activityAt:item.activity_at})}).catch(()=>{});
    if (!detail.canReply) { panel.append(textNode('p', 'Bu durumda yanıt gönderilemez. Ek bilgi istendiğinde bu alandan cevap verebilirsin.')); return; }
    const form=document.createElement('form'), note=document.createElement('textarea'), file=document.createElement('input'), consent=document.createElement('input');
    note.required=true; note.minLength=3; note.maxLength=2000; note.setAttribute('aria-label','Ek bilgi yanıtı');
    file.type='file'; file.accept='image/jpeg,image/png,image/webp'; file.setAttribute('aria-label','Ek kanıt fotoğrafı');
    consent.type='checkbox'; const label=document.createElement('label'); label.append(consent,document.createTextNode(' Ek fotoğrafın bu katkının kalan saklama süresince (en fazla 30 gün) özel alanda inceleme için tutulmasını onaylıyorum.'));
    const preview=document.createElement('img'); preview.alt='Ek kanıt önizlemesi'; preview.style.maxWidth='100%'; preview.hidden=true;
    let staged=null, previewUrl=null, key=crypto.randomUUID(), lastPayload=null;
    const discard=()=>{if(staged){accountRequest('/contributions/media/'+staged,{method:'DELETE'}).catch(()=>{});staged=null;}};
    file.addEventListener('change',()=>{discard();if(previewUrl)URL.revokeObjectURL(previewUrl);previewUrl=file.files[0]?URL.createObjectURL(file.files[0]):null;preview.hidden=!previewUrl;if(previewUrl)preview.src=previewUrl;consent.required=Boolean(file.files[0]);});
    const send=textNode('button','Yanıtı gönder ve yeniden incelemeye al','btn btn-primary'); send.type='submit';
    const status=textNode('p','','feedback'); status.setAttribute('role','status');
    form.append(textNode('label','Ek bilgi yanıtı'),note,file,preview,label,send,status);panel.append(form);
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(send.disabled)return;send.disabled=true;
      try {
        if(file.files[0] && !consent.checked) throw new Error('Fotoğraf saklama onayı gerekli.');
        if(file.files[0] && !staged){const blob=await prepareImageBlob(file.files[0]);if(!alive())return;const uploaded=await requestJson(base+'/reply-media',{method:'POST',headers:{Authorization:'Bearer '+accessToken,'Content-Type':'image/jpeg','X-Moderation-Photo-Consent':CONTRIBUTION_PHOTO_CONSENT_VERSION},body:blob});staged=uploaded.media.id;}
        const payload={note:note.value.trim(),mediaIds:staged?[staged]:[]};const encoded=JSON.stringify(payload);if(lastPayload!==encoded){key=crypto.randomUUID();lastPayload=encoded;}
        await accountRequest(base+'/replies',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,idempotencyKey:key})});staged=null;if(previewUrl)URL.revokeObjectURL(previewUrl);if(alive())await loadContributions();
      } catch(error){if(alive())status.textContent=error.message;} finally {send.disabled=false;}
    });
  } catch(error){if(alive())panel.textContent=error.message;}
}

async function loadAccountRequests(){if(!canReview())return;const generation=reviewAccessGeneration;try{const {requests}=await accountRequest('/review/account-requests');if(!canReview())return;const list=accountEl('accountRequests');list.replaceChildren();for(const r of requests){const li=textNode('li',r.display_name+' · '+r.email,'record-card');const approve=textNode('button','Onayla ve davet gönder','btn btn-primary btn-small');approve.type='button';approve.addEventListener('click',async()=>{approve.disabled=true;try{await accountRequest('/review/account-requests/'+encodeURIComponent(r.id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'approved'})});await loadAccountRequests();}catch(e){li.append(textNode('p',e.message,'feedback'));approve.disabled=false;}});const reject=textNode('button','Reddet','btn btn-secondary btn-small');reject.type='button';reject.addEventListener('click',async()=>{await accountRequest('/review/account-requests/'+encodeURIComponent(r.id),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:'rejected'})});await loadAccountRequests();});li.append(approve,reject);list.append(li);}}catch(e){if(generation===reviewAccessGeneration&&canReview())accountEl('adminStatus').textContent=e.message;}}

accountEl('showLoginBtn').addEventListener('click',()=>{accountEl('loginForm').classList.remove('hidden');accountEl('accountRequestForm').classList.add('hidden');accountEl('authChoice').classList.add('hidden');accountEl('emailInput').focus();});accountEl('showRequestBtn').addEventListener('click',()=>{accountEl('accountRequestForm').classList.remove('hidden');accountEl('loginForm').classList.add('hidden');accountEl('authChoice').classList.add('hidden');accountEl('requestName').focus();});accountEl('cancelRequestBtn').addEventListener('click',()=>{accountEl('accountRequestForm').classList.add('hidden');accountEl('authChoice').classList.remove('hidden');accountEl('showRequestBtn').focus();});accountEl('accountRequestForm').addEventListener('submit',async e=>{e.preventDefault();try{const r=await requestJson('/auth/requests',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({displayName:accountEl('requestName').value,email:accountEl('requestEmail').value})});accountEl('requestStatus').textContent=r.message;accountEl('accountRequestForm').reset();}catch(err){accountEl('requestStatus').textContent=err.message;}});

accountEl('previewReviewBtn').addEventListener('click',async()=>{if(!selectedReview||!canReview())return;const itemId=selectedReview.id;const v=verifiedLabelForm(selectedReview.barcode);const snapshot=JSON.stringify(v),button=accountEl('previewReviewBtn');button.disabled=true;try{const p=await accountRequest('/review/'+encodeURIComponent(itemId)+'/preview',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({verifiedLabel:v})});const now=verifiedLabelForm(selectedReview?.barcode);if(selectedReview?.id!==itemId||JSON.stringify(now)!==snapshot)return;activeReviewPreview=p.previewId;const box=accountEl('reviewPreview');box.replaceChildren(textNode('h4','Sunucu karar önizlemesi'),textNode('p','Kayıt işlemi ve uygunluk kararı ayrı değerlendirilir. Kaynak bağlantısı biçimsel olarak geçerli; kaynağın doğruluğu ayrıca otomatik doğrulanmıyor.'),textNode('p','Sunucu kararı: '+p.decision.level),textNode('p','Karar kanıtı: '+JSON.stringify(p.evidence||[])));box.classList.remove('hidden');accountEl('submitReviewBtn').disabled=false;}catch(e){accountEl('reviewStatus').textContent=e.message;}finally{button.disabled=false;}});for(const id of ['verifiedName','verifiedBrand','verifiedSource','verifiedLabel','evidenceChecked','verifiedEvidenceKind','verifiedObservedOn','verifiedLabelDate'])accountEl(id).addEventListener('input',()=>{activeReviewPreview=null;accountEl('submitReviewBtn').disabled=accountEl('reviewDecision').value==='approved';accountEl('reviewPreview').classList.add('hidden');});
accountEl('continueUserBtn').addEventListener('click',()=>{location.hash='#tara';});accountEl('continueAdminBtn').addEventListener('click',()=>{if(canReview())location.hash='#admin';});
