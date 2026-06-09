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
    document.getElementById('calContent').innerHTML = '<div style="text-align:center;padding:60px 0;color:var(--muted);font-family:\'Bebas Neue\',sans-serif;letter-spacing:2px;font-size:16px;">LOADING...</div>';
    await loadCalEvents();
    renderCalHeader();
    calRestorePostcode();
    renderCalContent();
    return;
  }

  if (hasSession) {
    showRoleSelector();
    return;
  }

  show('authScreen');
})();

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
    confirmClaim();
  }
  if (e.key === 'Enter' && document.getElementById('authScreen').classList.contains('active')) {
    if (document.getElementById('loginForm').style.display !== 'none') doLogin();
    else doSignup();
  }
});
