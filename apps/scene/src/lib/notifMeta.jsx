// Centralised notification type → colour + icon mapping.
// Colours are semantic, not read/unread-based.
// Green = success, Amber = action needed, Cyan = info, Pink/Purple = discovery, Red = negative, Orange = warning.

const GREEN   = { col: '#00E5A0', rgb: '0,229,160',   bg: '#0d2b22' };
const AMBER   = { col: '#F59E0B', rgb: '245,158,11',  bg: '#2b2010' };
const CYAN    = { col: '#00E5FF', rgb: '0,229,255',   bg: '#0a2530' };
const PINK    = { col: '#FF3399', rgb: '255,51,153',  bg: '#2b0d1a' };
const PURPLE  = { col: '#BF5FFF', rgb: '191,95,255',  bg: '#1a0d2b' };
const RED     = { col: '#FF4444', rgb: '255,68,68',   bg: '#2b0d0d' };
const ORANGE  = { col: '#FF8C42', rgb: '255,140,66',  bg: '#2b1800' };
const MUTED   = { col: '#9B9BAA', rgb: '155,155,170', bg: '#1a1a2a' };

export const TYPE_META = {
  new_application:    { label: 'NEW APPLICATION',   ...AMBER,  Icon: InboxIcon       },
  slot_offer:         { label: 'SLOT OFFER',         ...AMBER,  Icon: CalendarPlusIcon },
  availability_request:{ label: 'AVAILABILITY',     ...AMBER,  Icon: CalendarSearchIcon },
  payment_requested:  { label: 'PAYMENT DUE',        ...ORANGE, Icon: CreditCardIcon  },
  event_reminder:     { label: 'REMINDER',           ...ORANGE, Icon: BellRingIcon    },
  event_nearly_full:  { label: 'NEARLY FULL',        ...ORANGE, Icon: UsersIcon       },
  event_invite:       { label: 'INVITE',             ...PURPLE, Icon: CalendarPlusIcon },
  artist_updated:     { label: 'PROFILE UPDATED',   ...PURPLE, Icon: SparklesIcon    },
  event_published:    { label: 'EVENT LIVE',         ...PINK,   Icon: MegaphoneIcon   },
  festival_opened:    { label: 'FESTIVAL',           ...PINK,   Icon: TentIcon        },
  new_message:        { label: 'NEW MESSAGE',        ...PINK,   Icon: MessageCircleIcon },
  shortlisted:        { label: 'SHORTLISTED',        ...CYAN,   Icon: StarIcon        },
  event_updated:      { label: 'EVENT UPDATED',      ...CYAN,   Icon: PencilIcon      },
  set_times_released: { label: 'SET TIMES',          ...CYAN,   Icon: Clock3Icon      },
  new_follower:       { label: 'NEW FOLLOWER',       ...CYAN,   Icon: UserPlusIcon    },
  venue_followed:     { label: 'VENUE FOLLOWED YOU', ...CYAN,   Icon: Building2Icon   },
  slot_accepted:      { label: 'SLOT ACCEPTED',      ...GREEN,  Icon: CheckCircle2Icon },
  invite_accepted:    { label: 'INVITE ACCEPTED',    ...GREEN,  Icon: CheckCircle2Icon },
  booking_confirmed:  { label: 'BOOKING CONFIRMED',  ...GREEN,  Icon: CheckCircle2Icon },
  payment_received:   { label: 'PAYMENT RECEIVED',   ...GREEN,  Icon: WalletIcon      },
  profile_claimed:    { label: 'PROFILE VERIFIED',   ...GREEN,  Icon: CheckCircle2Icon },
  slot_declined:      { label: 'SLOT DECLINED',      ...RED,    Icon: XCircleIcon     },
  slot_removed:       { label: 'REMOVED FROM SLOT',  ...RED,    Icon: XCircleIcon     },
  invite_declined:    { label: 'INVITE DECLINED',    ...RED,    Icon: XCircleIcon     },
  booking_cancelled:  { label: 'BOOKING CANCELLED',  ...RED,    Icon: XCircleIcon     },
  application_declined:{ label: 'DECLINED',          ...RED,    Icon: XCircleIcon     },
  /* D2 · a festival released its decision. Written by a database trigger on
     festival_applications, so these arrive no matter which app releases —
     see 20260807000000_d2_festival_outcome_notification.sql.
     ⚠ DECLINED IS DELIBERATELY *MUTED*, NOT RED, breaking the pattern above.
     Red is for things that went wrong — a slot removed, a booking cancelled.
     Not being picked from four hundred applicants is an outcome, not a fault,
     and a red cross tells someone they failed at something they did not. It
     matches the tone the event page uses for the same fact. */
  festival_accepted:  { label: "YOU'RE IN",          ...GREEN,  Icon: CheckCircle2Icon },
  festival_declined:  { label: 'NOT THIS TIME',      ...MUTED,  Icon: TentIcon        },
  generic:            { label: 'NOTICE',             ...MUTED,  Icon: BellIcon        },
};

// Map legacy v1 emoji prefixes → type keys
const EMOJI_TYPE_MAP = {
  '✅': 'slot_accepted',
  '☑️': 'slot_accepted',
  '✓':  'slot_accepted',
  '❌': 'slot_declined',
  '✕':  'slot_declined',
  '📩': 'event_invite',
  '📅': 'event_invite',
  '⭐': 'shortlisted',
  '🚀': 'event_published',
  '📣': 'event_published',
  '💬': 'new_message',
  '💰': 'payment_received',
  '🔔': 'event_reminder',
};

// Infer type from the leading emoji of a v1 message
function inferTypeFromMessage(message = '') {
  const match = message.match(/^(\p{Emoji_Presentation}|\p{Emoji}️)/u);
  if (match) return EMOJI_TYPE_MAP[match[0]] || null;
  return null;
}

export function getNotifMeta(type, message) {
  if (TYPE_META[type]) return TYPE_META[type];
  // Fallback: try to infer from message emoji for old v1 data
  const inferred = inferTypeFromMessage(message);
  if (inferred && TYPE_META[inferred]) return TYPE_META[inferred];
  return TYPE_META.generic;
}

// Strip leading emoji + whitespace from a message string for display
export function cleanMessage(message = '') {
  return message.replace(/^[\p{Emoji_Presentation}\p{Emoji}️\s]+/u, '').trim();
}

// ── Icon components (Lucide-style SVGs, stroke-based) ──────────────────────

function Icon({ children, color, size = 18 }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      {children}
    </svg>
  );
}

export function InboxIcon({ color, size }) {
  return <Icon color={color} size={size}><polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11 2 12v3a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-3l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"/></Icon>;
}
export function UserPlusIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="19" y1="8" x2="19" y2="14"/><line x1="22" y1="11" x2="16" y2="11"/></Icon>;
}
export function CalendarPlusIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><path d="M8 16h4"/><path d="M16 14v4"/><path d="M14 16h4"/></Icon>;
}
export function StarIcon({ color, size }) {
  return <Icon color={color} size={size}><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></Icon>;
}
export function CheckCircle2Icon({ color, size }) {
  return <Icon color={color} size={size}><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></Icon>;
}
export function XCircleIcon({ color, size }) {
  return <Icon color={color} size={size}><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></Icon>;
}
export function MegaphoneIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="m3 11 18-5v12L3 14v-3z"/><path d="M11.6 16.8a3 3 0 1 1-5.8-1.6"/></Icon>;
}
export function PencilIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/><path d="m15 5 4 4"/></Icon>;
}
export function Clock3Icon({ color, size }) {
  return <Icon color={color} size={size}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16.5 12"/></Icon>;
}
export function BellRingIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/><path d="M4 2C2.8 3.7 2 5.7 2 8"/><path d="M20 2c1.2 1.7 2 3.7 2 6"/></Icon>;
}
export function MessageCircleIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="m3 21 1.9-5.7a8.5 8.5 0 1 1 3.8 3.8z"/></Icon>;
}
export function Building2Icon({ color, size }) {
  return <Icon color={color} size={size}><path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/><path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/><path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/><path d="M10 6h4"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/></Icon>;
}
export function WalletIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M19 7V4a1 1 0 0 0-1-1H5a2 2 0 0 0 0 4h15a1 1 0 0 1 1 1v4h-3a2 2 0 0 0 0 4h3a1 1 0 0 0 1-1v-2a1 1 0 0 0-1-1"/><path d="M3 5v14a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-4"/></Icon>;
}
export function CreditCardIcon({ color, size }) {
  return <Icon color={color} size={size}><rect width="20" height="14" x="2" y="5" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></Icon>;
}
export function CalendarSearchIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M16 2v4"/><path d="M8 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/><circle cx="15" cy="16" r="2.5"/><path d="m17 18 1.5 1.5"/></Icon>;
}
export function SparklesIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></Icon>;
}
export function TentIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M3.5 21 14 3"/><path d="M20.5 21 10 3"/><path d="M15.5 21 12 15l-3.5 6"/><path d="M2 21h20"/></Icon>;
}
export function UsersIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></Icon>;
}
export function BellIcon({ color, size }) {
  return <Icon color={color} size={size}><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></Icon>;
}
