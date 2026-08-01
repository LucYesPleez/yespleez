// Shared icons for §§ 5, 7–11. Stroke-based, 24-box, sized by the caller.

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' };

const svg = (size, cls, children) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={cls} {...P}>{children}</svg>
);

export const ShareIcon    = ({ size = 16, className }) => svg(size, className, <><path d="M12 3v13" /><path d="M8 7l4-4 4 4" /><path d="M4 14v5a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5" /></>);
export const CalendarIcon = ({ size = 16, className }) => svg(size, className, <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M3 10h18M8 3v4M16 3v4" /></>);
// ADD TO MY SCENE — a plus against the app's own concept, not a calendar. The
// distinction matters: this puts the event into the reader's scene, it does not
// write it into an external calendar.
export const SceneIcon    = ({ size = 16, className }) => svg(size, className, <><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>);
export const GlobeIcon    = ({ size = 16, className }) => svg(size, className, <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.7 2.5 15.3 0 18M12 3c-2.5 2.7-2.5 15.3 0 18" /></>);
export const PinIcon      = ({ size = 16, className }) => svg(size, className, <><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" /><circle cx="12" cy="10" r="3" /></>);
export const RouteIcon    = ({ size = 16, className }) => svg(size, className, <><circle cx="6" cy="19" r="3" /><circle cx="18" cy="5" r="3" /><path d="M9 19h6a4 4 0 0 0 0-8H9a4 4 0 0 1 0-8h3" /></>);
export const ChevronIcon  = ({ size = 15, className }) => svg(size, className, <path d="M9 6l6 6-6 6" />);
export const TickIcon     = ({ size = 13, className }) => svg(size, className, <path d="M20 6L9 17l-5-5" />);
export const ExpandIcon   = ({ size = 15, className }) => svg(size, className, <><path d="M15 3h6v6" /><path d="M9 21H3v-6" /><path d="M21 3l-7 7M3 21l7-7" /></>);
// SAVE TO DEVICE — an arrow into a tray. Deliberately not the Collect stack:
// collecting keeps a poster in the profile, saving puts a file on the phone.
export const DownloadIcon = ({ size = 15, className }) => svg(size, className, <><path d="M12 3v12" /><path d="M7 11l5 5 5-5" /><path d="M4 19h16" /></>);
// Lucide `tickets` — a stack of tickets rather than one, which is what a link
// to a ticket page actually offers.
export const TicketIcon   = ({ size = 16, className }) => svg(size, className, <><path d="m3.173 8.18 11-5a2 2 0 0 1 2.647.993L18.56 8" /><path d="M6 10V8" /><path d="M6 14v1" /><path d="M6 19v2" /><rect x="2" y="8" width="20" height="13" rx="2" /></>);
export const HeartIcon    = ({ size = 16, className, filled }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} {...P} fill={filled ? 'currentColor' : 'none'}>
    <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
  </svg>
);

// COLLECT — deliberately NOT a heart, bookmark or star. Those all read as
// "save this for later"; collecting a poster is keeping an artefact. Layers,
// because a collection is a stack of things you own.
export const CollectIcon  = ({ size = 16, className }) => svg(size, className, <><path d="M12 3l9 5-9 5-9-5 9-5z" /><path d="M3 13l9 5 9-5" /><path d="M3 17.5l9 5 9-5" /></>);

// Detail-row icons, chosen per key by EventDetails.
export const ClockIcon    = ({ size = 16, className }) => svg(size, className, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const StageIcon    = ({ size = 16, className }) => svg(size, className, <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>);
export const IdIcon       = ({ size = 16, className }) => svg(size, className, <><rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="12" r="2.5" /><path d="M14 10h4M14 14h4" /></>);
export const AccessIcon   = ({ size = 16, className }) => svg(size, className, <><circle cx="12" cy="4.5" r="2" /><path d="M9 20l3-8 3 8M6 9l6 1.5L18 9" /></>);
export const BagIcon      = ({ size = 16, className }) => svg(size, className, <><path d="M6 7h12l1 13H5L6 7z" /><path d="M9 7V5a3 3 0 0 1 6 0v2" /></>);
export const CarIcon      = ({ size = 16, className }) => svg(size, className, <><path d="M5 16h14M6 16l1.5-6h9L18 16" /><rect x="3" y="16" width="18" height="4" rx="1" /><circle cx="7.5" cy="20" r="1" /><circle cx="16.5" cy="20" r="1" /></>);
export const InfoIcon     = ({ size = 16, className }) => svg(size, className, <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>);
