import { registerServiceWorker } from "./ui/serviceWorker.js";
import { initApp } from "./ui/index.js";

registerServiceWorker();
initApp();

async function showVersion() {
  const versionElement = document.querySelector("#app-version");
  if (!versionElement) {
    return;
  }

  try {
    const response = await fetch("/version.json", { cache: "no-store" });
    if (!response.ok) {
      return;
    }
    const data = await response.json();
    if (typeof data.last_updated_utc === "string") {
      const updatedAt = new Date(data.last_updated_utc);
      if (!Number.isNaN(updatedAt.getTime())) {
        const monthNames = [
          "jan",
          "feb",
          "mar",
          "apr",
          "may",
          "jun",
          "jul",
          "aug",
          "sep",
          "oct",
          "nov",
          "dec",
        ];
        const year = updatedAt.getUTCFullYear();
        const month = monthNames[updatedAt.getUTCMonth()];
        const day = String(updatedAt.getUTCDate()).padStart(2, "0");
        const hours = String(updatedAt.getUTCHours()).padStart(2, "0");
        const minutes = String(updatedAt.getUTCMinutes()).padStart(2, "0");
        const seconds = String(updatedAt.getUTCSeconds()).padStart(2, "0");
        versionElement.textContent = `v. ${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      }
    }
  } catch (error) {
    console.warn("Unable to load version.", error);
  }
}

showVersion();

(function initAboutPopover() {
  const btn = document.querySelector("[popovertarget='about-popover']");
  const popover = document.querySelector("#about-popover");
  if (!btn || !popover) return;

  btn.addEventListener("click", () => {
    const rect = btn.getBoundingClientRect();
    popover.style.left = rect.left + "px";
    popover.style.top = (rect.bottom + 6) + "px";
    popover.style.position = "fixed";
  });
})();
