export function registerServiceWorker() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker
      .register("/sw.js")
      .catch((error) => {
        console.error("Service worker registration failed", error);
      });
  }
}

export async function registerFileWithServiceWorker(file, { displayName } = {}) {
  if (!file || !("serviceWorker" in navigator)) {
    return null;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const controller =
      navigator.serviceWorker.controller ?? registration?.active ?? null;
    if (!controller) {
      return null;
    }
    return await new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => {
        const { result, error } = event.data ?? {};
        if (error) {
          console.warn("Service worker file registration failed.", error);
          resolve(null);
          return;
        }
        resolve(result ?? null);
      };
      controller.postMessage(
        {
          type: "FDV_REGISTER_FILE",
          file,
          displayName: displayName ?? null,
        },
        [channel.port2],
      );
    });
  } catch (error) {
    console.warn("Service worker file registration failed.", error);
    return null;
  }
}
