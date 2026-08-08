// ═══════════════════════════════════════════════════
//  app.js — YesPleez Boot & Event Wiring
//  Load this LAST, after all modules
// ═══════════════════════════════════════════════════

(async function boot() {
  if (DEMO) demoOverrides();

  // Free trial banner
  const trialBanner = document.createElement('div');
  trialBanner.id = 'trialBanner';
  trialBanner.style.cssText = 'position:fixed;bottom:80px;left:0;right:0;z-index:9998;background:#1a1a00;border-top:1px solid var(--gold);border-bottom:1px solid var(--gold);color:var(--gold);font-size:11px;letter-spacing:2px;text-align:center;padding:7px;font-family:Bebas Neue,sans-serif;white-space:nowrap;overflow:hidden;';
  document.body.append(trialBanner);
  trialBanner.style.display = 'none';

  const params    = new URLSearchParams(location.search);
  const eventId   = params.get('event');
  const profileId = params.get('profile');
  const ptype     = params.get('ptype');
  const view      = params.get('view');
  const hasSession = await tryRestoreSession();

  if (eventId) {
    // Public event page — no login required
    const ok = await showPublicEventPage(eventId);
    if (ok) return;
  }

  if (profileId && ptype) {
    // Public profile deep link — load from DB then open
    try {
      const rows = await sbRest(`profiles?user_id=eq.${profileId}&type=eq.${encodeURIComponent(ptype)}&limit=1`, { method:'GET' }, null);
      if (rows && rows.length) { openPublicProfile(rows[0]); return; }
    } catch(e) { console.warn('profile deeplink:', e); }
  }

  if (view === 'calendar') {
    // Public What's On page — no login required
    show('calendarScreen');
    _calViewMonth = new Date(); _calSelDate = null;
    renderCalHeader();
    document.getElementById('calContent').innerHTML = skeletonHTML('calendar');
    await loadCalEvents();
    renderCalHeader();
    calRestorePostcode();
    renderCalContent();
    return;
  }

  if (hasSession) {
    showCalendar();
    return;
  }

  show('authScreen');
})();

// ── Add to Home Screen banner ──────────────────────

function _showA2HSBanner() {
  // Already installed as PWA
  if (window.navigator.standalone || window.matchMedia('(display-mode: standalone)').matches) return;
  // Permanently dismissed
  if (localStorage.getItem('yp_a2hs') === 'never') return;
  // Shown 5 times already
  const shown = parseInt(localStorage.getItem('yp_a2hs_count') || '0');
  if (shown >= 5) return;

  const isIOS     = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const isAndroid = /android/i.test(navigator.userAgent);
  if (!isIOS && !isAndroid) return; // desktop doesn't need this prompt

  const instructions = isIOS
    ? `Tap the <strong>Share</strong> button <svg style="vertical-align:middle;display:inline-block;" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg> at the bottom of your browser, then tap <strong>"Add to Home Screen"</strong>`
    : `Tap the <strong>menu</strong> <svg style="vertical-align:middle;display:inline-block;" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg> in your browser, then tap <strong>"Add to Home Screen"</strong> or <strong>"Install app"</strong>`;

  const banner = document.createElement('div');
  banner.id = 'a2hsBanner';
  banner.style.cssText = 'position:fixed;bottom:72px;left:0;right:0;z-index:9997;background:#0f0f1a;border-top:1px solid rgba(157,78,221,.4);padding:12px 16px 14px;font-family:sans-serif;';
  banner.innerHTML = `
    <div style="max-width:680px;margin:0 auto;">
      <div style="display:flex;align-items:flex-start;gap:10px;">
        <div style="font-size:22px;flex-shrink:0;line-height:1;">📲</div>
        <div style="flex:1;min-width:0;">
          <div style="font-family:'Bebas Neue',sans-serif;font-size:13px;letter-spacing:2px;color:var(--neon2);margin-bottom:4px;">ADD YESPLEEZ TO YOUR HOME SCREEN</div>
          <div style="font-size:12px;color:var(--muted);line-height:1.5;">${instructions} — loads faster and works like an app.</div>
        </div>
        <button onclick="document.getElementById('a2hsBanner').remove()" style="background:none;border:none;color:var(--muted);font-size:20px;line-height:1;padding:0 4px;cursor:pointer;flex-shrink:0;">×</button>
      </div>
      <button onclick="localStorage.setItem('yp_a2hs','never');document.getElementById('a2hsBanner').remove();"
        style="margin-top:10px;background:none;border:none;color:var(--muted);font-size:11px;letter-spacing:1px;font-family:'Bebas Neue',sans-serif;cursor:pointer;padding:0;text-decoration:underline;">
        DON'T SHOW AGAIN
      </button>
    </div>`;

  document.body.appendChild(banner);
  localStorage.setItem('yp_a2hs_count', shown + 1);
}

setTimeout(_showA2HSBanner, 12000); // show after 12s so it doesn't interrupt landing

// ── Overlay dismiss listeners ──────────────────────

document.getElementById('overlay').addEventListener('click', e => { if (e.target.id==='overlay') closeModal(); });
document.getElementById('pubLinkOverlay').addEventListener('click', e => { if (e.target.id==='pubLinkOverlay') closePubLinkOverlay(); });
document.getElementById('lineupRadioOverlay').addEventListener('click', e => { if (e.target.id==='lineupRadioOverlay') closeLineupRadio(); });
document.getElementById('confirmRemoveOverlay').addEventListener('click', e => { if (e.target.id==='confirmRemoveOverlay') closeConfirmRemove(); });
document.getElementById('applyOverlay').addEventListener('click', e => { if (e.target.id==='applyOverlay') closeApplyModal(); });
document.getElementById('becomeMemberOverlay').addEventListener('click', e => { if (e.target.id==='becomeMemberOverlay') closeMemberModal(); });
// document.getElementById('addGigOverlay').addEventListener('click', e => { if (e.target.id==='addGigOverlay') closeAddGigModal(); });
document.getElementById('withdrawConfirmOverlay').addEventListener('click', e => { if (e.target.id==='withdrawConfirmOverlay') closeWithdrawConfirm(); });
document.getElementById('slotOfferOverlay').addEventListener('click', e => { if (e.target.id==='slotOfferOverlay') closeSlotOffer(); });
document.getElementById('approvalCodesOverlay').addEventListener('click', e => { if (e.target.id==='approvalCodesOverlay') closeApprovalCodes(); });
document.getElementById('insertSlotOverlay').addEventListener('click', e => { if (e.target.id==='insertSlotOverlay') closeInsertSlot(); });
document.getElementById('slotConflictOverlay').addEventListener('click', e => { if (e.target.id==='slotConflictOverlay') closeSlotConflict(); });
document.getElementById('editEventOverlay').addEventListener('click', e => { if (e.target.id==='editEventOverlay') closeEditEventModal(); });

// ── Keyboard shortcuts ─────────────────────────────

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal(); closePubLinkOverlay(); closeEditEventModal();
    closeSlotConflict(); closeInsertSlot(); closeApprovalCodes();
    closeWithdrawConfirm(); closeConfirmRemove(); closeLineupRadio();
  }
  if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && document.getElementById('overlay').classList.contains('open')) {
    e.preventDefault(); // stop focused Cancel/other buttons from also firing
    confirmClaim();
  }
  if (e.key === 'Enter' && document.getElementById('authScreen').classList.contains('active')) {
    if (document.getElementById('loginForm').style.display !== 'none') doLogin();
    else doSignup();
  }
});
