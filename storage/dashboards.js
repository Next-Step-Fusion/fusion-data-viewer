const STORAGE_KEY = "fdv-dashboards-v1";

function isDashboardPlot(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.xPath === "string" &&
    typeof value.yPath === "string" &&
    (value.additionalYPaths === undefined ||
      (Array.isArray(value.additionalYPaths) &&
        value.additionalYPaths.every((entry) => typeof entry === "string"))) &&
    (value.fileKey === undefined || value.fileKey === null || typeof value.fileKey === "string") &&
    (value.fileLabel === undefined ||
      value.fileLabel === null ||
      typeof value.fileLabel === "string") &&
    (value.plotSettings === undefined ||
      value.plotSettings === null ||
      typeof value.plotSettings === "object") &&
    (value.plotOverrides === undefined ||
      value.plotOverrides === null ||
      typeof value.plotOverrides === "object")
  );
}

function isDashboard(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.id === "string" &&
    typeof value.name === "string" &&
    (value.fileKey === undefined || value.fileKey === null || typeof value.fileKey === "string") &&
    (value.fileLabel === undefined ||
      value.fileLabel === null ||
      typeof value.fileLabel === "string") &&
    Array.isArray(value.plots) &&
    value.plots.every((plot) => isDashboardPlot(plot))
  );
}

function sanitizeState(state) {
  const dashboards = Array.isArray(state?.dashboards)
    ? state.dashboards.filter((dashboard) => isDashboard(dashboard))
    : [];
  const activeDashboardId =
    typeof state?.activeDashboardId === "string"
      ? state.activeDashboardId
      : null;
  return { dashboards, activeDashboardId };
}

export function loadDashboardState() {
  if (typeof localStorage === "undefined") {
    return { dashboards: [], activeDashboardId: null };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { dashboards: [], activeDashboardId: null };
    }
    const parsed = JSON.parse(raw);
    return sanitizeState(parsed);
  } catch (error) {
    console.warn("Unable to load dashboards from storage.", error);
    return { dashboards: [], activeDashboardId: null };
  }
}

export function saveDashboardState(state) {
  if (typeof localStorage === "undefined") {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("Unable to save dashboards to storage.", error);
  }
}
