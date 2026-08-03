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
