// ═══════════════════════════════════════════════════
//  state.js — YesPleez Global State & Config
//  Load this FIRST before all other modules
// ═══════════════════════════════════════════════════

// ── Supabase config ────────────────────────────────
// ⚠️  Keep these out of public repos — use env vars in production

const SUPABASE_URL = 'https://doqzxvppibuzieajqkxm.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Ugs2Uz9OGWx__wDzntz0SQ_bGa0uF8P';

// ── Demo mode ──────────────────────────────────────
// Set to false when deploying live

const DEMO = false;

// ── Auth state ─────────────────────────────────────

let currentUser    = null;   // Supabase auth user object
let currentSession = null;   // Supabase session

// ── App state ──────────────────────────────────────

let currentEventId = null;   // UUID of currently viewed event
let eventData      = null;   // the event config being viewed/edited
let allEvents      = [];     // host's events list
let claims         = {};     // slot claims for current event
let activeKey      = null;   // slot key being claimed
let isHost            = false;  // is current viewer the host of current event?
let isReadOnly        = false;  // true when viewing an event from Discover (no edits allowed)
let currentEventHostId = null;  // host_id of the currently loaded event
let _eventCode        = null;   // { code, slotIds: null|string[] } validated code for current event
let _hasApplied       = false;  // whether current user has already applied to current event
let pollTimer      = null;
let currentMode    = null;   // 'host' or 'artist'

// ── Host controls ──────────────────────────────────

let hostControls = {
  artistRemove:  true,
  rankedBackups: true,
  genrePicker:   true
};

let approvalCodes  = {};     // code -> { used: bool, slotId: null|string } per event
let setTimesLocked = false;  // whether host has locked set times
let hostNotes      = {};     // slotId -> string, private host notes

// ── Profile state ──────────────────────────────────

let hostProfile   = {};      // promoter/host profile
let artistProfile = {};      // artist profile (loaded from localStorage or Supabase)

// Load artist profile from localStorage on start
try {
  const saved = localStorage.getItem('yp_artist_profile');
  if (saved) artistProfile = JSON.parse(saved);
} catch(e) {}

// Load host profile from localStorage on start
try {
  const saved = localStorage.getItem('yp_host_profile');
  if (saved) hostProfile = JSON.parse(saved);
} catch(e) {}

// ── Demo data ──────────────────────────────────────

const DEMO_USER = { id: 'demo-host-001', email: 'demo@yespleez.com' };

const DEMO_EVENTS = [
  {
    id: 'demo-event-001',
    host_id: 'demo-host-001',
    name: 'Solstice Soirée',
    status: 'live',
    host_controls: { artistRemove: true, rankedBackups: true, genrePicker: true },
    config: {
      name: 'Solstice Soirée', date: 'June 20 / 21', venue: 'Vabooshna',
      genres: 'Techno · House · Breaks',
      days: [
        { name: 'Saturday June 20', slots: [
          { id:'sat_0', time:'4:00',  ampm:'PM', dur:'1.5 hrs', label:'SUNSET SET' },
          { id:'sat_1', time:'5:30',  ampm:'PM', dur:'1.5 hrs', label:'' },
          { id:'sat_2', time:'7:00',  ampm:'PM', dur:'1 hr',    label:'' },
          { id:'sat_3', time:'8:00',  ampm:'PM', dur:'1 hr',    label:'' },
          { id:'sat_4', time:'9:00',  ampm:'PM', dur:'1 hr',    label:'' },
          { id:'sat_5', time:'10:00', ampm:'PM', dur:'1.5 hrs', label:'' },
          { id:'sat_6', time:'11:30', ampm:'PM', dur:'1.5 hrs', label:'MIDNIGHT CLOSER' },
          { id:'sat_7', time:'1:00',  ampm:'AM', dur:'Open end', label:'LOUNGE SESSIONS' },
        ]},
        { name: 'Sunday June 21', slots: [
          { id:'sun_0', time:'12:00', ampm:'PM', dur:'1.5 hrs', label:'' },
          { id:'sun_1', time:'1:30',  ampm:'PM', dur:'1.5 hrs', label:'' },
          { id:'sun_2', time:'3:00',  ampm:'PM', dur:'1.5 hrs', label:'' },
          { id:'sun_3', time:'4:30',  ampm:'PM', dur:'1.5 hrs', label:'' },
          { id:'sun_4', time:'6:00',  ampm:'PM', dur:'1.5 hrs', label:'Golden Hour' },
          { id:'sun_5', time:'7:30',  ampm:'PM', dur:'1.5 hrs', label:'' },
          { id:'sun_6', time:'9:00',  ampm:'PM', dur:'1 hr',    label:'' },
          { id:'sun_7', time:'10:00', ampm:'PM', dur:'Open end', label:'LOUNGE SESSIONS' },
        ]}
      ]
    }
  },
  {
    id: 'demo-event-002',
    host_id: 'demo-host-001',
    name: 'Test Draft Event',
    status: 'draft',
    host_controls: { artistRemove: false, rankedBackups: true, genrePicker: true },
    config: {
      name: 'Test Draft Event', date: 'TBC', venue: 'TBC', genres: '',
      days: [{ name: '', slots: [{ id:'d_0', time:'8:00', ampm:'PM', dur:'1 hr', label:'' }] }]
    }
  }
];