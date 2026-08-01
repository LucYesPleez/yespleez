// EP-00 · extracted verbatim from EventScreen.jsx. Pure helpers shared by the
// slot renderer and the slot editor; no React, no data access.
export function parseDurMins(raw) {
  if (!raw) return 0;
  const n = Number(raw);
  if (n > 0) return n;
  const s = String(raw);
  const hr = s.match(/^([\d.]+)\s*hrs?$/i);
  if (hr) return Math.round(parseFloat(hr[1]) * 60);
  const mn = s.match(/^([\d.]+)\s*mins?$/i);
  if (mn) return Math.round(parseFloat(mn[1]));
  return 0;
}

export function fmtDur(mins) {
  if (!mins) return null;
  const m = Number(mins);
  if (!m) return null;
  if (m < 60) return `${m} mins`;
  const h = m / 60;
  return `${h % 1 === 0 ? h : h.toFixed(1)} hr${h !== 1 ? 's' : ''}`;
}

export const LABEL_PALETTE = ['#FFB830', '#BF5FFF', '#00E5A0', '#FF6B6B', '#FF8C42', '#7BC8F6'];
export function labelColor(label) {
  if (!label) return '#FFB830';
  let hash = 0;
  for (let i = 0; i < label.length; i++) hash = (hash * 31 + label.charCodeAt(i)) & 0xFFFFFF;
  return LABEL_PALETTE[Math.abs(hash) % LABEL_PALETTE.length];
}
export function stripEmoji(str) {
  return str?.replace(/[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu, '').trim() || '';
}
