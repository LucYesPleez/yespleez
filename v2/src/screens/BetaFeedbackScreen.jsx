import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useSession } from '../App';
import HandIcon from '../components/HandIcon';
import VoiceDiagnosticsPanel from '../components/VoiceDiagnosticsPanel';
import s from './BetaFeedbackScreen.module.css';

// First-ever open of THIS screen shows the "Skitz!" welcome once, in this
// browser, forever — separate from BetaWelcomePopup's own one-time "Here we
// go!" popup, which is timed off app usage rather than off pressing this
// screen's own entry point.
const WELCOME_SEEN_KEY = 'yp_beta_feedback_welcome_seen';

const BUCKET = 'beta-feedback-attachments';
const MAX_ATTACHMENT_BYTES = 100 * 1024 * 1024;

const TYPES = [
  { value: 'BUG', label: '🐛 Bug' },
  { value: 'SUGGESTION', label: '💡 Suggestion' },
  { value: 'LOVE', label: '❤️ Love This' },
  { value: 'QUESTION', label: '❓ Question' },
];
const AREAS = ['Messaging', 'Events', 'Discover', 'Profiles', 'Calendar', 'Notifications', 'Voiceys', 'Performance', 'Other'];
const SEVERITIES = [
  { value: 'BLOCKER', label: 'App unusable', dot: '#c86c75' },
  { value: 'MAJOR', label: 'Doesn’t work properly', dot: '#c99359' },
  { value: 'MINOR', label: 'Minor issue', dot: '#c8b367' },
  { value: 'IMPROVEMENT', label: 'Improvement', dot: '#8c9f80' },
];

export default function BetaFeedbackScreen() {
  const navigate = useNavigate();
  const { session } = useSession();
  const userId = session?.user?.id;

  const [phase, setPhase] = useState(() => (localStorage.getItem(WELCOME_SEEN_KEY) ? 'details' : 'welcome'));
  const [type, setType] = useState('BUG');
  const [area, setArea] = useState('');
  const [severity, setSeverity] = useState('');
  const [description, setDescription] = useState('');
  const [files, setFiles] = useState([]);
  const [errors, setErrors] = useState({});
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState('');
  const [feedbackId, setFeedbackId] = useState(null);
  const fileInputRef = useRef(null);

  // Marked seen the moment we decide to show it, not on continue — closing
  // the tab without pressing on still counts as having seen it once.
  useEffect(() => {
    if (phase === 'welcome') localStorage.setItem(WELCOME_SEEN_KEY, '1');
  }, [phase]);

  function continueToAttachments() {
    const invalidArea = !area;
    const invalidDescription = !description.trim();
    const invalidSeverity = type === 'BUG' && !severity;
    setErrors({ area: invalidArea, description: invalidDescription, severity: invalidSeverity });
    if (!invalidArea && !invalidDescription && !invalidSeverity) setPhase('attachments');
  }

  function openFilePicker(accept) {
    if (!fileInputRef.current) return;
    fileInputRef.current.accept = accept;
    fileInputRef.current.click();
  }

  function onFilesChosen(e) {
    const picked = [...e.target.files].filter(f => f.size <= MAX_ATTACHMENT_BYTES);
    setFiles(prev => {
      const next = [...prev];
      for (const f of picked) {
        if (!next.some(x => x.name === f.name && x.size === f.size)) next.push(f);
      }
      return next;
    });
    e.target.value = '';
  }

  function removeFile(index) {
    setFiles(prev => prev.filter((_, i) => i !== index));
  }

  async function send() {
    if (!userId || sending) return;
    setSending(true);
    setSendErr('');

    // Upload first, insert second — an attachment failure must not leave a
    // feedback row pointing at a file that was never actually written.
    const attachmentPaths = [];
    for (const file of files) {
      const ext = (file.name.split('.').pop() || 'bin').toLowerCase();
      const path = `${userId}/${crypto.randomUUID()}.${ext}`;
      const { error } = await supabase.storage.from(BUCKET)
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) {
        setSendErr('Attachment upload failed — ' + (error.message || 'unknown error'));
        setSending(false);
        return;
      }
      attachmentPaths.push(path);
    }

    const { data, error } = await supabase.from('beta_feedback').insert({
      user_id: userId,
      type,
      area,
      severity: type === 'BUG' ? severity : null,
      description: description.trim(),
      attachment_paths: attachmentPaths,
    }).select('id').single();

    setSending(false);
    if (error) {
      setSendErr('Send failed — ' + (error.message || 'unknown error'));
      return;
    }
    setFeedbackId(data.id);
    setPhase('success');
  }

  return (
    <div className={s.screen}>
      {phase === 'welcome' && (
        <WelcomePhase onContinue={() => setPhase('details')} />
      )}

      {phase === 'details' && (
        <DetailsPhase
          type={type} setType={setType}
          area={area} setArea={setArea}
          severity={severity} setSeverity={setSeverity}
          description={description} setDescription={setDescription}
          errors={errors}
          onContinue={continueToAttachments}
        />
      )}

      {phase === 'attachments' && (
        <AttachmentsPhase
          files={files}
          onAddScreenshot={() => openFilePicker('image/*')}
          onAddRecording={() => openFilePicker('video/*')}
          onRemoveFile={removeFile}
          onSend={send}
          sending={sending}
          sendErr={sendErr}
        />
      )}

      {phase === 'success' && (
        <SuccessPhase feedbackId={feedbackId} onHome={() => navigate('/')} />
      )}

      {/* ⚠ OUTSIDE the phase blocks, deliberately. It first sat inside
          `welcome`, which live verification proved invisible: the welcome
          screen is shown ONCE (WELCOME_SEEN_KEY), so anyone who had already
          opened this page — the owner included — would land on `details` and
          never see the panel at all.

          Here because this screen is one tap from the global header on every
          route, and a phone-call scenario cannot be run while navigating.
          Collapsed by default; hidden on `success` so it cannot intrude on
          the thank-you. See VoiceDiagnosticsPanel. */}
      {phase !== 'success' && <VoiceDiagnosticsPanel />}

      {/* One hidden input serves both Screenshot and Recording — the accept
          attribute is set immediately before each click. */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        style={{ display: 'none' }}
        onChange={onFilesChosen}
      />
    </div>
  );
}

function WelcomePhase({ onContinue }) {
  return (
    <div className={s.intro}>
      <HandIcon size={90} style={{ margin: '0 0 8px', color: '#fff' }} />
      <h2 className={s.introHeading}>Skitz!</h2>
      <p className={s.emphasis}>ur actually gonna give me feedback you weapon!</p>
      <p className={s.introBody}>
        So, don’t be scurr’d. Even friends who said they had nothing creative to add have
        helped shape a large portion of this app. I'm essentially building it around the
        niche needs and wants of you as individuals then adapting everyone else to fit. So
        if theres things you want that I have missed, don’t hold back. It could very well
        end up in the app!!
      </p>
      <p className={s.introBody}>Also, if you find something dope, tell me that too!</p>
      <p className={s.signature}>Chz!<br />Lucious</p>
      <button type="button" className={`${s.primaryBtn} ${s.welcomeBtn}`} onClick={onContinue}>
        Rad. Let's do it
      </button>
    </div>
  );
}

function DetailsPhase({ type, setType, area, setArea, severity, setSeverity, description, setDescription, errors, onContinue }) {
  return (
    <>
      <p className={s.progressCue}>Page 1/2</p>

      <div className={s.field}>
        <p className={s.stepLabel}>1. Feedback Type <span className={s.required}>*</span></p>
        <div className={s.typeGrid}>
          {TYPES.map(t => (
            <button
              key={t.value}
              type="button"
              className={type === t.value ? s.typeSelected : s.type}
              onClick={() => setType(t.value)}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className={s.field}>
        <label className={s.stepLabel} htmlFor="beta-area">2. Area <span className={s.required}>*</span></label>
        <select id="beta-area" className={s.select} value={area} onChange={e => setArea(e.target.value)}>
          <option value="">Choose an area</option>
          {AREAS.map(a => <option key={a}>{a}</option>)}
        </select>
        {errors.area && <p className={s.error}>Choose the part of the app this is about.</p>}
      </div>

      {type === 'BUG' && (
        <div className={s.field}>
          <p className={s.stepLabel}>3. Severity <span className={s.required}>*</span> <span className={s.hint}>(Bug only)</span></p>
          <div className={s.severity}>
            {SEVERITIES.map(sv => (
              <label key={sv.value}>
                <input
                  type="radio" name="severity" value={sv.value}
                  checked={severity === sv.value}
                  onChange={() => setSeverity(sv.value)}
                />
                <i className={s.dot} style={{ background: sv.dot }} />
                {sv.label}
              </label>
            ))}
          </div>
          {errors.severity && <p className={s.error}>Pick how much this is affecting you.</p>}
        </div>
      )}

      <div className={s.field}>
        <label className={s.stepLabel} htmlFor="beta-description">4. Description <span className={s.required}>*</span></label>
        <textarea
          id="beta-description"
          className={s.textarea}
          maxLength={4000}
          placeholder="The more detail, the better."
          value={description}
          onChange={e => setDescription(e.target.value)}
        />
        <div className={s.count}>{description.length}/4000</div>
        {errors.description && <p className={s.error}>Tell us a little more before sending.</p>}
      </div>

      <button type="button" className={s.primaryBtn} onClick={onContinue}>Continue</button>
    </>
  );
}

function AttachmentsPhase({ files, onAddScreenshot, onAddRecording, onRemoveFile, onSend, sending, sendErr }) {
  return (
    <>
      <p className={s.progressCue}>Page 2/2</p>
      <p className={s.stepLabel}>Attachments <span className={s.hint}>(optional)</span></p>
      <p className={s.attachmentsCopy}>Screenshots and screen recordings help us understand exactly what happened.</p>

      <div className={s.attachActions}>
        <button type="button" className={s.secondaryBtn} onClick={onAddScreenshot}>
          ＋ &nbsp; Add Screenshot
          <small>Attach an image from your device</small>
        </button>
        <button type="button" className={s.secondaryBtn} onClick={onAddRecording}>
          ＋ &nbsp; Add Screen Recording
          <small>Attach a video from your device</small>
        </button>
      </div>

      {files.length > 0 && (
        <div className={s.fileList}>
          {files.map((file, index) => (
            <div key={file.name + file.size} className={s.file}>
              <span className={s.fileIcon}>{file.type.startsWith('video') ? '▶' : '📷'}</span>
              <span className={s.fileName}>{file.name}</span>
              <button type="button" className={s.remove} onClick={() => onRemoveFile(index)} aria-label={`Remove ${file.name}`}>×</button>
            </div>
          ))}
        </div>
      )}

      {sendErr && <p className={s.error}>{sendErr}</p>}
      <button type="button" className={s.primaryBtn} onClick={onSend} disabled={sending}>
        {sending ? 'Sending…' : 'Send Feedback'}
      </button>
    </>
  );
}

function SuccessPhase({ feedbackId, onHome }) {
  return (
    <div className={s.intro}>
      <HandIcon size={90} style={{ margin: '0 0 8px', color: '#fff' }} />
      <h2 className={s.introHeading}>Thanks for helping build YesPleez.</h2>
      <p className={s.introBody}>
        You’re one of the original heads helping shape YesPleez from day one. Every bug you
        report, every idea you share and every suggestion you make helps make the app better
        for the whole scene.
      </p>
      <div className={s.reference}>
        <span>Feedback ID</span>
        <b>#{feedbackId}</b>
      </div>
      <p className={s.introBody}>Every submission is personally reviewed.</p>
      <p className={s.introBody}>Thanks for being one of the gang.</p>
      <p className={s.signature}>Chz!<br />Lucious</p>
      <button type="button" className={s.primaryBtn} onClick={onHome}>Back to Home</button>
    </div>
  );
}
