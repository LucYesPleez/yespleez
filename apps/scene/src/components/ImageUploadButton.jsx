import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { loadCorrectedCanvas } from '../lib/imageUtils';
import { uploadAvatar, uploadPoster, uploadCover } from '../lib/uploadImage';
import ImageCropperModal from './ImageCropperModal';
import s from './ImageUploadButton.module.css';

/**
 * Render-prop component that handles the full upload pipeline:
 * file pick → EXIF correct → crop → resize → WebP → Supabase Storage → URL
 *
 * Props:
 *   type       'avatar' | 'poster' | 'cover'
 *   userId     used to build the storage path
 *   bucket     Supabase bucket name (for avatars; posters bucket is fixed)
 *   pathPrefix storage path prefix, e.g. 'artist_avatars'
 *   onUpload   called with { avatar_hero, avatar_thumb } (avatar),
 *              { poster, poster_thumb, poster_full } (poster),
 *              or { cover, cover_thumb } (cover)
 *   children   render prop: ({ trigger, status }) => JSX
 *              status: 'idle' | 'loading' | 'cropping' | 'optimising' | 'uploading'
 */
export default function ImageUploadButton({ type = 'avatar', userId, bucket = 'avatars', pathPrefix, onUpload, children }) {
  const fileRef  = useRef(null);
  const [status, setStatus]       = useState('idle');
  const [canvas, setCanvas]       = useState(null); // corrected canvas waiting to crop
  const originalCanvas            = useRef(null);   // pre-crop original
  /**
   * ⚠ THE FAILURE HAS TO REACH THE PERSON WHO PRESSED THE BUTTON.
   *
   * Both catch blocks below used to `console.error` and nothing more: the
   * badge went UPLOADING… then silently back to idle with the old picture
   * still in place. Reported as "trying to replace profile pic and it wont"
   * (owner, 2026-08-04) — which is precisely what a swallowed error looks like
   * from the outside, and gives no way to tell a rejected file from a storage
   * policy from a dead connection.
   *
   * Storage errors here are ordinary and diagnosable — a bucket policy that
   * allows INSERT but not UPDATE fails only on REPLACE, a file over the size
   * limit, an unsupported type — and every one of them is actionable if it is
   * said out loud.
   */
  const [error, setError]         = useState('');

  // Only the cropping types need an aspect. 'poster' is absent on purpose —
  // it never reaches the cropper (see handleFile), and leaving a 4:5 here
  // would read as "posters are 4:5", which is exactly the belief that cost us
  // the top and bottom of every non-4:5 poster.
  //   cover  3:2 — the Hero's own frame aspect (heroMedia's heroFrameAspect),
  //                so what the organiser crops is what the Hero shows.
  //   avatar 1:1
  const aspect = type === 'cover' ? 3 / 2 : 1;

  function trigger() {
    fileRef.current?.click();
  }

  async function handleFile(e) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    // A new attempt clears the last complaint — otherwise a stale message sits
    // under a picture that has since uploaded fine.
    setError('');

    setStatus('loading');
    try {
      const corrected = await loadCorrectedCanvas(file);
      originalCanvas.current = corrected;
      // ⚠ A POSTER IS NEVER CROPPED — layout spec §0.1, "The Cover may crop.
      // The Poster may not." It went through the same 4:5 cropper as
      // everything else, which cut the top and bottom off any poster that
      // wasn't already 4:5 — the edges carrying dates, lineup and ticket
      // source. Cards crop at display time via object-fit, so the framing
      // step was destroying artwork to duplicate something CSS does
      // reversibly. Straight to upload, at the artwork's own aspect.
      if (type === 'poster') {
        await handleDone(corrected);
        return;
      }
      setCanvas(corrected);
      setStatus('cropping');
    } catch (err) {
      console.error('Image load failed', err);
      setError(err?.message || 'That image could not be opened. Try a different file.');
      setStatus('idle');
    }
  }

  async function handleDone(croppedCanvas) {
    setCanvas(null);
    setStatus('optimising');

    // Brief "Optimising…" moment so user sees feedback
    await new Promise(r => setTimeout(r, 350));
    setStatus('uploading');

    try {
      let result;
      if (type === 'poster') {
        result = await uploadPoster(croppedCanvas, userId, 'new', originalCanvas.current);
      } else if (type === 'cover') {
        // No original passed: a Cover may crop by design (§0.1), so the
        // pre-crop canvas is not something any surface renders.
        result = await uploadCover(croppedCanvas, userId, 'new');
      } else {
        result = await uploadAvatar(croppedCanvas, bucket, `${pathPrefix}/${userId}`);
      }
      onUpload(result);
    } catch (err) {
      console.error('Upload failed', err);
      // Supabase storage errors carry the useful part in `message` — "new row
      // violates row-level security policy", "The object exceeded the maximum
      // allowed size". Shown verbatim rather than replaced with a friendly
      // sentence: a generic "something went wrong" is what made this
      // undiagnosable in the first place.
      setError(err?.message || 'The upload failed. Please try again.');
    } finally {
      setStatus('idle');
    }
  }

  function handleCancel() {
    setCanvas(null);
    setStatus('idle');
  }

  const statusLabel = status === 'optimising' ? 'OPTIMISING…' : status === 'uploading' ? 'UPLOADING…' : null;

  return (
    <>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={handleFile}
      />

      {children({ trigger, status, statusBadge: statusLabel && (
        <div className={s.statusBadge}>{statusLabel}</div>
      ) })}

      {/* ⚠ OUTSIDE the children render-prop, so it appears for EVERY caller —
          avatars, posters and covers — without each of them having to opt in.
          Callers lay out their own button however they like; none of them
          would have thought to render an error they never knew existed. */}
      {error && (
        <div role="alert" style={{
          marginTop: 8, padding: '8px 10px', borderRadius: 8,
          border: '1px solid rgba(255,45,120,.4)', background: 'rgba(255,45,120,.08)',
          color: 'var(--text)', fontSize: 12, lineHeight: 1.45, overflowWrap: 'anywhere',
        }}>
          {error}
        </div>
      )}

      {status === 'cropping' && canvas && createPortal(
        <ImageCropperModal
          correctedCanvas={canvas}
          aspect={aspect}
          onDone={handleDone}
          onCancel={handleCancel}
        />,
        document.body,
      )}
    </>
  );
}
