// ═══════════════════════════════════════════════════
//  audio.js — YesPleez Audio / Mini Player Module
//  Handles SoundCloud & Mixcloud playback, lineup radio
//  Depends on: state.js, navigation.js (showToast)
// ═══════════════════════════════════════════════════

// ── Player state ───────────────────────────────────

let _playerState = {
  url: null, playing: false, scWidget: null, mcPlayer: null,
  duration: 0, position: 0, progressTimer: null,
  clipMode: true, clipDuration: 90, clipTimer: null,
  lineupMode: false, lineupQueue: [], lineupIndex: 0,
  lineupClipMins: 10,
  lineupTimer: null
};

// ── Helpers ────────────────────────────────────────

function setMiniPlayState(playing) {
  const playIcon  = document.getElementById('miniPlayIcon');
  const pauseIcon = document.getElementById('miniPauseIcon');
  if (playIcon)  playIcon.style.display  = playing ? 'none' : '';
  if (pauseIcon) pauseIcon.style.display = playing ? '' : 'none';
}

function getSCEmbedUrl(url) {
  return `https://w.soundcloud.com/player/?url=${encodeURIComponent(url)}&color=%2300e5ff&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&show_teaser=false`;
}

function getMCEmbedUrl(url) {
  return `https://www.mixcloud.com/widget/iframe/?hide_cover=1&mini=1&autoplay=1&feed=${encodeURIComponent(url.replace('https://www.mixcloud.com',''))}`;
}

function isSoundCloud(url) { return url && url.includes('soundcloud.com'); }
function isMixcloud(url)   { return url && url.includes('mixcloud.com'); }

// ── Open mini player ───────────────────────────────

async function openMiniPlayer(artistName, mixUrl, avatarEmoji, opts={}) {
  if (!mixUrl) return;
  const url = mixUrl.trim();
  if (!isSoundCloud(url) && !isMixcloud(url)) {
    showToast('Mix link must be a SoundCloud or Mixcloud URL.', 'error');
    return;
  }

  stopMiniPlayerProgress();
  clearLineupTimer();

  _playerState.url     = url;
  _playerState.playing = true;
  _playerState.scWidget = null;
  _playerState.duration = 0;
  _playerState.position = 0;
  _playerState.clipMode = !_playerState.lineupMode;
  _playerState.clipDuration = 90 * 1000;

  document.getElementById('miniPlayerName').textContent  = artistName || 'Artist';
  document.getElementById('miniPlayerTrack').textContent = '⏳ Loading...';
  const avatarEl = document.getElementById('miniPlayerAvatar');
  avatarEl.innerHTML = '';
  avatarEl.textContent = avatarEmoji || '🎧';
  setMiniPlayState(false);
  _playerState.playing = false;
  document.getElementById('miniProgressBar').style.width = '0%';
  updateLineupUI();

  try {
    const oEmbedUrl = isSoundCloud(url)
      ? `https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`
      : `https://www.mixcloud.com/oembed/?format=json&url=${encodeURIComponent(url)}`;
    const res = await fetch(oEmbedUrl);
    if (res.ok) {
      const data = await res.json();
      if (data.title) document.getElementById('miniPlayerTrack').textContent = '▶ ' + data.title;
      if (data.thumbnail_url) {
        const img = document.createElement('img');
        img.src = data.thumbnail_url;
        avatarEl.innerHTML = '';
        avatarEl.appendChild(img);
      }
    }
  } catch(e) {}

  const frame = document.getElementById('miniPlayerFrame');
  const embedUrl = isSoundCloud(url) ? getSCEmbedUrl(url) : getMCEmbedUrl(url);
  frame.src = embedUrl;

  if (isSoundCloud(url)) {
    frame.onload = () => {
      if (window.SC && window.SC.Widget) {
        _playerState.scWidget = window.SC.Widget(frame);
        _playerState.scWidget.bind(window.SC.Widget.Events.READY, () => {
          _playerState.scWidget.getDuration(d => {
            _playerState.duration = d;
            let seekMs;
            if (_playerState.lineupMode) {
              seekMs = 60 * 1000;
            } else {
              const pct = 0.2 + Math.random() * 0.5;
              seekMs = d * pct;
            }
            _playerState.position = seekMs;
            _playerState.scWidget.seekTo(seekMs);
            startMiniPlayerProgress();
            startClipTimer();
          });
        });
        _playerState.scWidget.bind(window.SC.Widget.Events.PLAY, () => {
          _playerState.playing = true;
          setMiniPlayState(true);
        });
        _playerState.scWidget.bind(window.SC.Widget.Events.PAUSE, () => {
          _playerState.playing = false;
          setMiniPlayState(false);
        });
        _playerState.scWidget.bind(window.SC.Widget.Events.FINISH, () => {
          setMiniPlayState(false);
          document.getElementById('miniProgressBar').style.width = '100%';
          stopMiniPlayerProgress();
          if (_playerState.lineupMode) advanceLineup();
        });
      } else {
        startMiniPlayerProgress();
        startClipTimer();
      }
    };
  } else {
    frame.onload = () => {
      _playerState.playing = true;
      setMiniPlayState(true);
      document.getElementById('miniPlayerTrack').textContent = '▶ Mixcloud mix';
      document.getElementById('miniProgressBar').style.width = '0%';
      startMiniPlayerProgress();
      startClipTimer();
    };
  }

  document.getElementById('miniPlayer').classList.add('open');
  document.body.classList.add('player-open');
}

// ── Timers ─────────────────────────────────────────

function startClipTimer() {
  clearClipTimer();
  if (_playerState.lineupMode) {
    const ms = _playerState.lineupClipMins * 60 * 1000;
    _playerState.lineupTimer = setTimeout(() => advanceLineup(), ms);
  } else {
    _playerState.clipTimer = setTimeout(() => {
      if (_playerState.scWidget) _playerState.scWidget.pause();
      stopMiniPlayerProgress();
      setMiniPlayState(false);
      document.getElementById('miniPlayerTrack').textContent = '⏹ Preview ended';
    }, _playerState.clipDuration);
  }
}

function clearClipTimer() {
  if (_playerState.clipTimer) { clearTimeout(_playerState.clipTimer); _playerState.clipTimer = null; }
}

function clearLineupTimer() {
  if (_playerState.lineupTimer) { clearTimeout(_playerState.lineupTimer); _playerState.lineupTimer = null; }
}

// ── Player controls ────────────────────────────────

function closeMiniPlayer() {
  stopMiniPlayerProgress();
  clearClipTimer();
  clearLineupTimer();
  _playerState.lineupMode = false;
  document.getElementById('miniPlayer').classList.remove('open');
  document.body.classList.remove('player-open');
  document.getElementById('miniPlayerFrame').src = '';
  updateLineupUI();
  _playerState = {
    url: null, playing: false, scWidget: null, duration: 0, position: 0,
    progressTimer: null, clipMode: true, clipDuration: 90000, clipTimer: null,
    lineupMode: false, lineupQueue: [], lineupIndex: 0, lineupClipMins: 10, lineupTimer: null
  };
}

function toggleMiniPlay() {
  if (_playerState.scWidget) {
    _playerState.scWidget.isPaused(paused => {
      if (paused) { _playerState.scWidget.play(); startClipTimer(); }
      else        { _playerState.scWidget.pause(); clearClipTimer(); clearLineupTimer(); }
    });
  } else {
    _playerState.playing = !_playerState.playing;
    setMiniPlayState(_playerState.playing);
    if (_playerState.playing) { startMiniPlayerProgress(); startClipTimer(); }
    else { stopMiniPlayerProgress(); clearClipTimer(); clearLineupTimer(); }
  }
}

// ── Progress bar ───────────────────────────────────

function startMiniPlayerProgress() {
  stopMiniPlayerProgress();
  const windowMs = _playerState.lineupMode
    ? _playerState.lineupClipMins * 60 * 1000
    : _playerState.clipDuration;
  const startTime = Date.now();

  _playerState.progressTimer = setInterval(() => {
    if (_playerState.scWidget) {
      _playerState.scWidget.getPosition(pos => {
        _playerState.position = pos;
        if (_playerState.duration > 0) {
          if (_playerState.lineupMode) {
            const elapsed = pos - (60 * 1000);
            const pct = Math.min(Math.max(elapsed / windowMs * 100, 0), 100);
            document.getElementById('miniProgressBar').style.width = pct + '%';
          } else {
            document.getElementById('miniProgressBar').style.width = (pos / _playerState.duration * 100) + '%';
          }
        }
      });
    } else {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(elapsed / windowMs * 100, 100);
      document.getElementById('miniProgressBar').style.width = pct + '%';
    }
  }, 1000);
}

function stopMiniPlayerProgress() {
  if (_playerState.progressTimer) { clearInterval(_playerState.progressTimer); _playerState.progressTimer = null; }
}

function seekMiniPlayer(e) {
  if (_playerState.scWidget && _playerState.duration > 0 && !_playerState.lineupMode) {
    const wrap = e.currentTarget;
    const pct = e.offsetX / wrap.offsetWidth;
    const seekPos = pct * _playerState.duration;
    _playerState.scWidget.seekTo(seekPos);
    document.getElementById('miniProgressBar').style.width = (pct * 100) + '%';
  }
}

function skipForward30() {
  if (_playerState.scWidget && _playerState.duration > 0) {
    _playerState.scWidget.getPosition(pos => {
      const newPos = Math.min(pos + 30000, _playerState.duration - 1000);
      _playerState.scWidget.seekTo(newPos);
      if (_playerState.duration > 0) {
        document.getElementById('miniProgressBar').style.width = (newPos / _playerState.duration * 100) + '%';
      }
      clearClipTimer();
      startClipTimer();
    });
  } else {
    showToast('Scrubbing only works with SoundCloud links.', 'error');
  }
}

// ── Lineup playback ────────────────────────────────

function buildLineupQueue() {
  const queue = [];
  (eventData?.days || []).forEach(day => {
    (day.slots || []).forEach(s => {
      const claim = claims[s.id];
      if (claim?.mixLink) {
        queue.push({
          name: claim.name,
          mixLink: claim.mixLink,
          time: s.time + ' ' + s.ampm,
          dur: s.dur,
          dayName: day.name || ''
        });
      }
    });
  });
  return queue;
}

function setLineupMode(mins) {
  _playerState.lineupClipMins = mins;

  const pairs = [
    ['lineup10Btn', 'lineup20Btn'],
    ['artistFlow10Btn', 'artistFlow20Btn']
  ];
  pairs.forEach(([id10, id20]) => {
    const btn10 = document.getElementById(id10);
    const btn20 = document.getElementById(id20);
    if (!btn10 || !btn20) return;
    if (mins === 10) {
      btn10.style.background = 'var(--neon2)'; btn10.style.color = '#0a0a0f'; btn10.style.border = 'none';
      btn20.style.background = 'transparent';  btn20.style.color = 'var(--muted)'; btn20.style.border = '1px solid var(--border)';
    } else {
      btn20.style.background = 'var(--neon2)'; btn20.style.color = '#0a0a0f'; btn20.style.border = 'none';
      btn10.style.background = 'transparent';  btn10.style.color = 'var(--muted)'; btn10.style.border = '1px solid var(--border)';
    }
  });

  if (_playerState.lineupMode) {
    clearLineupTimer();
    startClipTimer();
    updateLineupUI();
  } else {
    playLineup(mins);
  }
}

function playLineup(clipMins) {
  const queue = buildLineupQueue();
  if (!queue.length) {
    showToast('No artists with mix links in this lineup.', 'error');
    return;
  }
  _playerState.lineupMode     = true;
  _playerState.lineupQueue    = queue;
  _playerState.lineupIndex    = 0;
  _playerState.lineupClipMins = clipMins || 10;
  playLineupTrack(0);
}

function playLineupTrack(idx) {
  const queue = _playerState.lineupQueue;
  if (idx >= queue.length) {
    _playerState.lineupMode = false;
    showToast('🎉 Lineup preview complete!', 'success');
    closeMiniPlayer();
    return;
  }
  _playerState.lineupIndex = idx;
  const artist = queue[idx];
  openMiniPlayer(artist.name, artist.mixLink, '🎧');
}

function advanceLineup() {
  if (!_playerState.lineupMode) return;
  clearLineupTimer();
  stopMiniPlayerProgress();
  playLineupTrack(_playerState.lineupIndex + 1);
}

function skipLineupTrack() {
  if (!_playerState.lineupMode) return;
  clearLineupTimer();
  clearClipTimer();
  stopMiniPlayerProgress();
  if (_playerState.scWidget) _playerState.scWidget.pause();
  playLineupTrack(_playerState.lineupIndex + 1);
}

function updateLineupUI() {
  const skipBtn   = document.getElementById('miniSkipBtn');
  const lineupLbl = document.getElementById('miniLineupLabel');
  if (!skipBtn || !lineupLbl) return;
  if (_playerState.lineupMode && _playerState.lineupQueue.length) {
    const idx   = _playerState.lineupIndex;
    const total = _playerState.lineupQueue.length;
    const mins  = _playerState.lineupClipMins;
    skipBtn.style.display   = '';
    lineupLbl.style.display = '';
    lineupLbl.textContent   = `${idx + 1} of ${total} · ${mins} min preview`;
  } else {
    skipBtn.style.display   = 'none';
    lineupLbl.style.display = 'none';
  }
}

// ── Lineup radio modal ─────────────────────────────

function openLineupRadio() {
  const mixCount    = Object.values(claims).filter(c => c.mixLink).length;
  const totalClaims = Object.keys(claims).length;
  document.getElementById('lineupRadioDesc').textContent =
    `Get a feel for the lineup flow. Play each artist's mix in set time order. ${mixCount} of ${totalClaims} artists have mixes linked.`;
  document.getElementById('lineupRadioOverlay').classList.add('open');
}

function closeLineupRadio() {
  document.getElementById('lineupRadioOverlay').classList.remove('open');
}

// ── Load SoundCloud Widget API ─────────────────────
(function() {
  if (!document.getElementById('sc-widget-api')) {
    const s = document.createElement('script');
    s.id  = 'sc-widget-api';
    s.src = 'https://w.soundcloud.com/player/api.js';
    document.head.appendChild(s);
  }
})();