// An attachment preview that works with PRIVATE Drive files (queue task A2b).
// Drop-in for `<img src={getGoogleDrivePreviewUrl(url)} …/>`: a Drive file of
// ours is fetched through the Apps Script and shown from a blob: URL; if the
// script refuses (old version, file not ours) it falls back to the old public
// preview URL, and the caller's onError hides the box as before. A file that
// turns out not to be an image (a PDF, a Word file) is treated as an error too.

import React, { useEffect, useState } from 'react';
import { driveFileIdOf, fetchDriveFile } from '../lib/driveFiles';
import { getGoogleDrivePreviewUrl } from '../utils';

type Props = Omit<React.ImgHTMLAttributes<HTMLImageElement>, 'src'> & { url: string };

export default function DriveImage({ url, onError, ...rest }: Props) {
  const id = driveFileIdOf(url);
  const [src, setSrc] = useState<string | null>(id ? null : url);
  const [notImage, setNotImage] = useState(false);

  useEffect(() => {
    if (!id) { setSrc(url); setNotImage(false); return; }
    let live = true;
    setSrc(null);
    setNotImage(false);
    fetchDriveFile(id).then(
      f => { if (!live) return; if (f.mimeType.startsWith('image/')) setSrc(f.blobUrl); else setNotImage(true); },
      () => { if (live) setSrc(getGoogleDrivePreviewUrl(url)); },
    );
    return () => { live = false; };
  }, [id, url]);

  // Not an image: render an <img> with no source so the caller's onError runs
  // and collapses the preview box exactly as a broken image did before.
  if (notImage && !onError) return null;
  if (notImage) return <img {...rest} alt={rest.alt} onError={onError} src="data:," data-drive-image="not-image" />;
  if (!src) return null;
  return <img {...rest} alt={rest.alt} onError={onError} src={src} />;
}
