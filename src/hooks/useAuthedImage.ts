import { useEffect, useState } from 'react';

// Loads an image that needs the user's Bearer token (e.g. their private KYC
// photo) and returns it as a data: URI for <Image source={{ uri }}>.
// <Image headers> isn't reliably sent on Android release builds, so the image
// is fetched with a normal request — the same way every other API call
// authenticates — and handed to <Image> already downloaded.
export function useAuthedImage(url: string | null, token?: string | null) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUri(null);
    setFailed(false);
    if (!url || !token) return;

    (async () => {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        const dataUri = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onloadend = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error);
          reader.readAsDataURL(blob);
        });
        if (!cancelled) setUri(dataUri);
      } catch (e) {
        console.warn('[useAuthedImage] could not load image:', e);
        if (!cancelled) setFailed(true);
      }
    })();

    return () => { cancelled = true; };
  }, [url, token]);

  return { uri, failed };
}
