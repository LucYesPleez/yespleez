export const STATUS_TAB_COLOR = {
  NEW:         '#FFD700',
  AWAITING:    '#FFD700',
  SEEN:        '#FF8C42',
  SHORTLISTED: '#00B4D8',
  INTERESTED:  '#00B4D8',
  ACCEPTED:    '#00E5A0',
  BOOKED:      '#00E5A0',
  DECLINED:    '#888',
  REJECTED:    '#888',
};

export function normaliseStatus(e) {
  const dir = (e.direction || 'incoming').toLowerCase();
  const st  = (e.status   || 'pending').toLowerCase();
  if (dir === 'outgoing') {
    if (st === 'pending')   return 'awaiting';
    if (st === 'tentative') return 'interested';
  } else {
    if (st === 'pending')   return 'new';
    if (st === 'viewed')    return 'seen';
    if (st === 'tentative') return 'shortlisted';
  }
  return st;
}
