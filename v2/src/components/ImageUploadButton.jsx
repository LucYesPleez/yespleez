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

  // 3:2 for a cover — the Hero's own frame aspect (heroMedia's
  // `heroFrameAspect`), so what the organiser crops is what the Hero shows.
  const aspect = type === 'poster' ? 4 / 5 : type === 'cover' ? 3 / 2 : 1;

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
