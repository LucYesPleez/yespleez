// ═══════════════════════════════════════════════════
//  app.js — YesPleez Boot & Event Wiring
//  Load this LAST, after all modules
// ═══════════════════════════════════════════════════

(async function boot() {
  if (DEMO) demoOverrides();

  // Free trial banner
  const trialBanner = document.createElement('div');
  trialBanner.id = 'trialBanner';
  trialBanner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9998;background:#1a1a00;border-bottom:1px solid var(--gold);color:var(--gold);font-size:11px;letter-spacing:2px;text-align:center;padding:7px;font-family:Bebas Neue,sans-serif;';
  trialBanner.textContent = "YOU'RE IN FREE TRIAL MODE";
  document.body.prepend(trialBanner);

  const params  = new URLSearchParams(location.search);
  const eventId = params.get('event');
  const hasSession = await tryRestoreSession();

  if (eventId) {
    const ok = await loadPublicEvent(eventId);
    if (ok) { showSignup(); return; }
  }

  if (hasSession) {
    const lastMode = localStorage.getItem('yp_last_mode');
    if (lastMode === 'host')   { currentMode = 'host';   enterDashboard();       return; }
    if (lastMode === 'artist') { currentMode = 'artist'; enterArtistDashboard(); return; }
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
