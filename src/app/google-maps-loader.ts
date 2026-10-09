let loading: Promise<void> | undefined;

/** Injects the Google Maps JS API script once and resolves when `google.maps` is ready. */
export function loadGoogleMaps(apiKey: string): Promise<void> {
  loading ??= new Promise<void>((resolve, reject) => {
    const callback = '__onGoogleMapsLoaded';
    (window as unknown as Record<string, () => void>)[callback] = () => resolve();
    const script = document.createElement('script');
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}` +
      `&libraries=marker&loading=async&callback=${callback}`;
    script.async = true;
    script.onerror = () => {
      loading = undefined;
      reject(new Error('Failed to load Google Maps'));
    };
    document.head.appendChild(script);
  });
  return loading;
}
