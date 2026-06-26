export const renameProperties = (
  features: { begin?: string | number; [key: string]: unknown }[]
) =>
  features.map((ft) => ({
    ...ft,
    start: ft.begin || undefined,
  }));

export const loadComponent = (
  name: string,
  elementConstructor: CustomElementConstructor
) => {
  if (!customElements.get(name)) {
    customElements.define(name, elementConstructor);
  }
};

// Returns an object of the form url => payload json
// getUrl optional function modifies url string
export const fetchAll = async (
  urls: string[],
  getUrl: ((url: string) => string) | null = null
) =>
  Object.fromEntries(
    await Promise.all(
      urls.map(async (url) => {
        try {
          const response = await fetch(getUrl ? getUrl(url) : url);
          if (!response.ok) {
            // TODO handle this better based on error code
            // Fail silently for now
            console.warn(`HTTP error status: ${response.status} at ${url}`);
            return [url, null];
          }
          return [url, await response.json()];
        } catch (error) {
          console.warn(`Failed to fetch or parse JSON from ${url}:`, error);
          return [url, null]; // or handle error data as needed
        }
      })
    )
  );
