import {
  createDefaultPlotSettings,
  disposePlot,
  renderHeatmapPlot,
  renderXYPlot,
  renderXYPlotSeries,
} from "../../viz/index.js";
import { loadDashboardState, saveDashboardState } from "../../storage/dashboards.js";
import { isNumericDtype } from "../../data/index.js";
import { icons } from "../icons.js";

function createId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `dash-${Math.random().toString(16).slice(2)}-${Date.now()}`;
}

function clampIndex(value, maxIndex) {
  const numeric = Number.parseInt(value ?? 0, 10);
  if (Number.isNaN(numeric)) {
    return 0;
  }
  return Math.min(Math.max(numeric, 0), Math.max(maxIndex, 0));
}

function parseFiniteNumber(value) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return parsed;
}

function resolvePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return fallback;
}

function resolveIndexRange(length, settings, axis) {
  if (!length) {
    return { start: 0, end: 0 };
  }
  const rangeModeKey = axis === "y" ? "yRangeMode" : "xRangeMode";
  if (settings?.[rangeModeKey] !== "manual") {
    return { start: 0, end: length };
  }
  const minKey = axis === "y" ? "yRangeMin" : "xRangeMin";
  const maxKey = axis === "y" ? "yRangeMax" : "xRangeMax";
  const minValue = parseFiniteNumber(settings?.[minKey]);
  const maxValue = parseFiniteNumber(settings?.[maxKey]);
  if (minValue === null || maxValue === null) {
    return { start: 0, end: length };
  }
  const resolvedMin = Math.floor(Math.min(minValue, maxValue));
  const resolvedMax = Math.ceil(Math.max(minValue, maxValue));
  const start = Math.min(Math.max(resolvedMin, 0), length);
  const end = Math.min(Math.max(resolvedMax, start), length);
  return { start, end };
}

function resolveSamplingStep(rangeLength, maxElements, decimationStep) {
  let step = resolvePositiveInteger(decimationStep, 1);
  if (rangeLength > maxElements) {
    step = Math.max(step, Math.ceil(rangeLength / maxElements));
  }
  return step;
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => stableStringify(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries
      .map(([key, entryValue]) => `${JSON.stringify(key)}:${stableStringify(entryValue)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function isNumeric1D(dataset) {
  return (
    dataset &&
    Array.isArray(dataset.shape) &&
    dataset.shape.length === 1 &&
    isNumericDtype(dataset.dtype)
  );
}

function normalizeAxisName(name) {
  if (!name) {
    return "";
  }
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function isInvalidIdentifierError(error) {
  const message = String(error?.message ?? "").toLowerCase();
  return (
    message.includes("invalid identifier") ||
    message.includes("invalid location identifier")
  );
}

const DEFAULT_DASHBOARD_LAYOUT = {
  gridColumns: 2,
  compactMode: false,
  syncSliders: false,
  sliderControlsVisible: true,
  syncHover: false,
  hoverMode: "x unified",
  aspectRatio: "16:9",
};

const DASHBOARD_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:2", label: "3:2" },
  { value: "10:2", label: "10:2" },
  { value: "16:10", label: "16:10" },
  { value: "16:9", label: "16:9" },
];

const DASHBOARD_ASPECT_RATIO_VALUES = new Set(
  DASHBOARD_ASPECT_RATIOS.map((option) => option.value),
);

function clampGridColumns(value) {
  const numeric = Number.parseInt(value ?? DEFAULT_DASHBOARD_LAYOUT.gridColumns, 10);
  if (Number.isNaN(numeric)) {
    return DEFAULT_DASHBOARD_LAYOUT.gridColumns;
  }
  return Math.min(Math.max(numeric, 1), 3);
}

function normalizeDashboardLayout(dashboard) {
  const layout =
    dashboard.layout && typeof dashboard.layout === "object"
      ? dashboard.layout
      : {};
  const normalized = {
    gridColumns: clampGridColumns(layout.gridColumns),
    compactMode: Boolean(layout.compactMode),
    syncSliders: Boolean(layout.syncSliders),
    sliderControlsVisible:
      typeof layout.sliderControlsVisible === "boolean"
        ? layout.sliderControlsVisible
        : DEFAULT_DASHBOARD_LAYOUT.sliderControlsVisible,
    syncHover: Boolean(layout.syncHover),
    hoverMode: normalizeHoverMode(layout.hoverMode),
    aspectRatio: normalizeAspectRatio(layout.aspectRatio),
  };
  if (layout !== normalized) {
    Object.assign(layout, normalized);
  }
  dashboard.layout = layout;
  return layout;
}

function normalizeHoverMode(value) {
  if (value === "x" || value === "x unified") {
    return value;
  }
  return DEFAULT_DASHBOARD_LAYOUT.hoverMode;
}

function normalizeAspectRatio(value) {
  if (DASHBOARD_ASPECT_RATIO_VALUES.has(value)) {
    return value;
  }
  return DEFAULT_DASHBOARD_LAYOUT.aspectRatio;
}

function buildDashboardPlotOverrides(dashboard, plot, plotSettings) {
  const hoverMode = normalizeHoverMode(dashboard.layout?.hoverMode);
  const overrides = plot.plotOverrides ?? null;
  const nextOverrides = { ...(overrides ?? {}) };
  const nextLayout = { ...(overrides?.layout ?? {}) };
  const hoverEnabled = plotSettings?.hoverEnabled ?? true;
  const showHoverSpikes =
    hoverEnabled && (hoverMode === "x" || hoverMode === "x unified");
  if (hoverEnabled && hoverMode) {
    nextLayout.hovermode = hoverMode;
  }
  if (showHoverSpikes) {
    nextLayout.xaxis = {
      ...(nextLayout.xaxis ?? {}),
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
    };
  }
  if (dashboard.layout?.compactMode) {
    nextLayout.xaxis = {
      ...(nextLayout.xaxis ?? {}),
      title: {
        ...(nextLayout.xaxis?.title ?? {}),
        text: "",
      },
    };
  }
  if (Object.keys(nextLayout).length > 0) {
    nextOverrides.layout = nextLayout;
  }
  return Object.keys(nextOverrides).length > 0 ? nextOverrides : overrides;
}

export function createDashboardView({
  tabList,
  addButton,
  panelContainer,
  getDatasetIndex,
  getDatasetByPath,
  getSession,
  hasSession,
  loadPlotly,
  onCustomizePlot,
  onDashboardDelete,
}) {
  let dashboards = [];
  let activeDashboardId = null;
  let currentFileKey = null;
  let currentFileLabel = "";
  const plotElements = new Map();
  const dashboardElements = new Map();
  const datasetSliceCache = new Map();
  const datasetSliceCacheOrder = [];
  const MAX_DATASET_CACHE_ENTRIES = 200;
  let isSyncingSliders = false;
  let isSyncingHover = false;

  function buildSliceCacheKey({ fileKey, datasetPath, operation, params }) {
    return [
      fileKey ?? "unknown-file",
      datasetPath ?? "unknown-dataset",
      operation ?? "unknown-operation",
      stableStringify(params ?? {}),
    ].join("|");
  }

  function touchDatasetSliceCacheKey(cacheKey) {
    const existingIndex = datasetSliceCacheOrder.indexOf(cacheKey);
    if (existingIndex !== -1) {
      datasetSliceCacheOrder.splice(existingIndex, 1);
    }
    datasetSliceCacheOrder.push(cacheKey);
  }

  function pruneDatasetSliceCache() {
    while (datasetSliceCacheOrder.length > MAX_DATASET_CACHE_ENTRIES) {
      const oldestKey = datasetSliceCacheOrder.shift();
      if (oldestKey) {
        datasetSliceCache.delete(oldestKey);
      }
    }
  }

  function clearDatasetSliceCache() {
    datasetSliceCache.clear();
    datasetSliceCacheOrder.length = 0;
  }

  async function readDatasetWithCache({
    fileKey,
    datasetPath,
    operation,
    params,
    reader,
  }) {
    const cacheKey = buildSliceCacheKey({
      fileKey,
      datasetPath,
      operation,
      params,
    });
    if (datasetSliceCache.has(cacheKey)) {
      touchDatasetSliceCacheKey(cacheKey);
      return datasetSliceCache.get(cacheKey);
    }
    const result = await reader();
    datasetSliceCache.set(cacheKey, result);
    touchDatasetSliceCacheKey(cacheKey);
    pruneDatasetSliceCache();
    return result;
  }

  function canCreateDashboard() {
    return Boolean(currentFileKey);
  }

  function updateAddButtonState() {
    if (!addButton) {
      return;
    }
    addButton.disabled = !canCreateDashboard();
  }

  function persist() {
    saveDashboardState({ dashboards, activeDashboardId });
  }

  async function getDatasetOptions(fileKey) {
    return (await getDatasetIndex?.(fileKey)) ?? [];
  }

  async function getSliceSyncKey(plot, dataset, datasetsIndex) {
    const axis = Number.isInteger(plot?.sliceAxis) ? plot.sliceAxis : 0;
    const yPath = plot?.yPath ?? "";
    if (!dataset || !Array.isArray(dataset.shape)) {
      return `${yPath}|axis:${axis}|length:0`;
    }
    if (plot.yMode !== "2d" && plot.yMode !== "heatmap") {
      return `${yPath}|axis:${axis}|length:0`;
    }

    let axisLength = 0;
    if (plot.yMode === "2d") {
      const [rows = 0, cols = 0] = dataset.shape ?? [];
      axisLength = axis === 1 ? cols : rows;
    } else {
      axisLength = dataset.shape?.[axis] ?? 0;
    }

    const datasetOptions =
      datasetsIndex ?? (await getDatasetOptions(plot.fileKey));
    const parentPath = dataset.parentPath;
    const axisNames = axis === 0 ? ["time", `dim${axis}`] : [`dim${axis}`];
    for (const name of axisNames) {
      const axisDataset = findAxisDatasetByName(
        datasetOptions,
        parentPath,
        name,
        axisLength,
      );
      if (axisDataset) {
        return `axis-name:${normalizeAxisName(axisDataset.name)}|length:${axisLength}`;
      }
    }

    return `${yPath}|axis:${axis}|length:${axisLength}`;
  }

  function getShapeKey(dataset, fallbackLength = 0) {
    if (Array.isArray(dataset?.shape) && dataset.shape.length) {
      return `shape:${dataset.shape.join("x")}`;
    }
    return `length:${fallbackLength}`;
  }

  async function getHoverSyncKey(plot, yDataset, xDataset, datasetsIndex) {
    if (!plot || plot.yMode !== "1d") {
      return null;
    }
    const yLength = yDataset?.shape?.[0] ?? 0;
    if (plot.xPath && xDataset) {
      return getShapeKey(xDataset, yLength);
    }
    if (yDataset?.parentPath) {
      const datasetOptions =
        datasetsIndex ?? (await getDatasetOptions(plot.fileKey));
      const axisDataset =
        findAxisDatasetByName(
          datasetOptions,
          yDataset.parentPath,
          "time",
          yLength,
        ) ??
        findAxisDatasetByName(
          datasetOptions,
          yDataset.parentPath,
          "dim0",
          yLength,
        );
      if (axisDataset) {
        return getShapeKey(axisDataset, yLength);
      }
    }
    return `length:${yLength}`;
  }

  function ensureActiveDashboard() {
    if (activeDashboardId && dashboards.some((d) => d.id === activeDashboardId)) {
      return activeDashboardId;
    }
    activeDashboardId = dashboards[0]?.id ?? null;
    return activeDashboardId;
  }

  function renderTabButton(dashboard) {
    const wrapper = document.createElement("div");
    wrapper.className = "dashboard-tab";

    const button = document.createElement("button");
    button.className = "tab-button dashboard-tab-button";
    button.type = "button";
    button.role = "tab";
    button.dataset.tab = dashboard.id;

    const label = document.createElement("span");
    label.className = "dashboard-tab-label dashboard-tab-text";
    label.textContent = dashboard.name;
    button.appendChild(label);

    const tabInput = document.createElement("input");
    tabInput.type = "text";
    tabInput.className = "dashboard-tab-input";
    tabInput.setAttribute("aria-label", "Dashboard name");

    const actions = document.createElement("div");
    actions.className = "dashboard-tab-actions";

    const renameButton = document.createElement("button");
    renameButton.type = "button";
    renameButton.className = "dashboard-tab-action";
    renameButton.innerHTML = icons.pencil;
    renameButton.setAttribute("aria-label", "Rename dashboard");
    renameButton.title = "Rename dashboard";

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "dashboard-tab-action dashboard-tab-action--danger";
    deleteButton.innerHTML = icons.x;
    deleteButton.setAttribute("aria-label", "Delete dashboard");
    deleteButton.title = "Delete dashboard";

    actions.appendChild(renameButton);
    actions.appendChild(deleteButton);

    wrapper.appendChild(button);
    wrapper.appendChild(tabInput);
    wrapper.appendChild(actions);

    return {
      wrapper,
      button,
      label,
      tabInput,
      renameButton,
      deleteButton,
    };
  }

  function getPlotFileLabel(plot) {
    return plot.fileLabel || "the linked file";
  }

  function getPlotTitle(plot) {
    const fileLabel = plot.fileLabel || "Unnamed file";
    const plotTitle = plot.plotSettings?.title?.trim() || "Plot";
    const needsRelink = !plot.fileKey && (plot.xPath || plot.yPath);
    const prefix = needsRelink ? "[Re-open the file to render] " : "";
    return `${prefix}${fileLabel} - ${plotTitle}`;
  }

  function ensurePlotFileBinding(dashboard, plot) {
    if (plot.fileKey) {
      return;
    }
    if (plot.xPath || plot.yPath) {
      return;
    }
    const fallbackKey = dashboard.fileKey ?? currentFileKey;
    if (!fallbackKey) {
      return;
    }
    plot.fileKey = fallbackKey;
    plot.fileLabel =
      (plot.fileLabel ?? dashboard.fileLabel ?? currentFileLabel) ||
      "Unnamed file";
    persist();
  }

  function updateDashboardWarning(dashboard) {
    const elements = dashboardElements.get(dashboard.id);
    if (!elements) {
      return;
    }
    if (!dashboard.plots.length) {
      elements.warning.hidden = true;
      elements.cloneButton.hidden = true;
      return;
    }
    const relinkPlots = dashboard.plots.filter(
      (plot) => !plot.fileKey && (plot.xPath || plot.yPath),
    );
    if (relinkPlots.length) {
      elements.warningText.textContent =
        "Some plots need to be re-linked to a file.";
      elements.warning.hidden = false;
      elements.cloneButton.hidden = !currentFileKey;
      return;
    }
    elements.warning.hidden = true;
    elements.cloneButton.hidden = true;
  }

  function updatePlotAvailability() {
    plotElements.forEach((entry) => {
      const plot = entry.plot;
      const isDisabled = !plot.fileKey;
      entry.setDisabled(isDisabled, getPlotFileLabel(plot));
    });
  }

  function updateDashboardSliderVisibility(dashboardId) {
    plotElements.forEach((entry) => {
      if (entry.dashboardId !== dashboardId) {
        return;
      }
      entry.updateSliceControlsVisibility?.();
    });
  }

  function activateDashboard(id) {
    const tabButton = tabList.querySelector(`.tab-button[data-tab="${id}"]`);
    if (tabButton) {
      tabButton.click();
      return;
    }
    setActiveDashboard(id);
  }

  function updateDashboardName(dashboard, nextName) {
    const resolvedName = nextName.trim() || "Untitled dashboard";
    dashboard.name = resolvedName;
    const elements = dashboardElements.get(dashboard.id);
    if (elements?.tabLabel) {
      elements.tabLabel.textContent = resolvedName;
    }
    if (elements?.tabInput) {
      elements.tabInput.value = resolvedName;
    }
    persist();
  }

  function startTabRename(dashboard) {
    const elements = dashboardElements.get(dashboard.id);
    if (!elements?.tabWrapper || !elements?.tabInput) {
      return;
    }
    elements.tabWrapper.classList.add("is-editing");
    elements.tabInput.value = dashboard.name;
    elements.tabInput.focus();
    elements.tabInput.select();
  }

  function finishTabRename(dashboard, { commit }) {
    const elements = dashboardElements.get(dashboard.id);
    if (!elements?.tabWrapper || !elements?.tabInput) {
      return;
    }
    if (!elements.tabWrapper.classList.contains("is-editing")) {
      return;
    }
    if (commit) {
      updateDashboardName(dashboard, elements.tabInput.value);
    } else {
      elements.tabInput.value = dashboard.name;
    }
    elements.tabWrapper.classList.remove("is-editing");
  }

  function cloneDashboardForCurrentFile(dashboard) {
    if (!currentFileKey) {
      return;
    }
    const cloneId = createId();
    const clone = {
      ...dashboard,
      id: cloneId,
      name: `${dashboard.name} (Clone)`,
      layout: { ...normalizeDashboardLayout(dashboard) },
      fileKey: currentFileKey,
      fileLabel: currentFileLabel || "Unnamed file",
      plots: dashboard.plots.map((plot) => ({
        ...plot,
        id: createId(),
        fileKey: currentFileKey,
        fileLabel: currentFileLabel || "Unnamed file",
      })),
    };
    dashboards.push(clone);
    persist();
    renderDashboards();
    activateDashboard(cloneId);
  }

  function renderDashboardPanel(dashboard) {
    const layout = normalizeDashboardLayout(dashboard);
    const panel = document.createElement("div");
    panel.className = "tab-panel dashboard-panel";
    panel.role = "tabpanel";
    panel.dataset.panel = "dashboard";
    panel.dataset.dashboardId = dashboard.id;

    const header = document.createElement("div");
    header.className = "dashboard-header";

    const headerActions = document.createElement("div");
    headerActions.className = "dashboard-header-actions";

    const gridToggle = document.createElement("div");
    gridToggle.className = "dashboard-grid-toggle";
    gridToggle.setAttribute("role", "tablist");
    gridToggle.setAttribute("aria-label", "Plots per row");

    const gridToggleButtons = new Map();
    [1, 2, 3].forEach((value) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "dashboard-grid-toggle-button";
      button.textContent = String(value);
      button.title = value === 1 ? "1 column" : `${value} columns`;
      button.dataset.columns = String(value);
      button.setAttribute("role", "tab");
      button.setAttribute("aria-selected", "false");
      gridToggleButtons.set(value, button);
      gridToggle.appendChild(button);
    });

    const customizeButton = document.createElement("button");
    customizeButton.type = "button";
    customizeButton.className = "plot-customize-button";
    customizeButton.innerHTML = icons.settings;
    customizeButton.title = "Customize";

    headerActions.appendChild(gridToggle);
    headerActions.appendChild(customizeButton);
    header.appendChild(headerActions);

    const warning = document.createElement("div");
    warning.className = "dashboard-file-warning";
    warning.hidden = true;

    const warningText = document.createElement("span");
    warningText.className = "dashboard-file-warning-text";

    const cloneButton = document.createElement("button");
    cloneButton.type = "button";
    cloneButton.className = "button button-secondary";
    cloneButton.textContent = "Clone";

    warning.appendChild(warningText);
    warning.appendChild(cloneButton);

    const plotsGrid = document.createElement("div");
    plotsGrid.className = "dashboard-grid";
    plotsGrid.dataset.columns = String(layout.gridColumns);
    plotsGrid.classList.toggle("is-compact", layout.compactMode);

    const customizeOverlay = document.createElement("div");
    customizeOverlay.className = "dashboard-customize-overlay";
    customizeOverlay.hidden = true;

    const customizePanel = document.createElement("aside");
    customizePanel.className = "dashboard-customize-panel";
    customizePanel.hidden = true;
    customizePanel.setAttribute("aria-hidden", "true");
    const customizePanelId = createId();
    customizePanel.id = customizePanelId;
    customizeButton.setAttribute("aria-controls", customizePanelId);
    customizeButton.setAttribute("aria-expanded", "false");

    const customizeHeader = document.createElement("div");
    customizeHeader.className = "plot-customize-header";

    const customizeTitle = document.createElement("h3");
    customizeTitle.className = "sr-only";
    customizeTitle.textContent = "Dashboard settings";

    const customizeActions = document.createElement("div");
    customizeActions.className = "plot-customize-actions";

    const customizeReset = document.createElement("button");
    customizeReset.type = "button";
    customizeReset.className = "plot-customize-reset";
    customizeReset.innerHTML = icons.rotate;
    customizeReset.title = "Reset";

    customizeActions.appendChild(customizeReset);
    customizeHeader.appendChild(customizeTitle);
    customizeHeader.appendChild(customizeActions);

    const customizeBody = document.createElement("div");
    customizeBody.className = "plot-customize-body";

    const aspectSection = document.createElement("section");
    aspectSection.className = "plot-customize-section";

    const compactLabel = document.createElement("label");
    compactLabel.className = "plot-customize-checkbox";

    const compactToggle = document.createElement("input");
    compactToggle.type = "checkbox";
    compactToggle.checked = layout.compactMode;

    const compactText = document.createElement("span");
    compactText.textContent = "Reduce spacing and hide X-axis titles";

    compactLabel.appendChild(compactToggle);
    compactLabel.appendChild(compactText);

    const aspectField = document.createElement("label");
    aspectField.className = "plot-customize-field";

    const aspectLabel = document.createElement("span");
    aspectLabel.className = "plot-customize-title";
    aspectLabel.textContent = "Aspect ratio";

    const aspectRatioSelect = document.createElement("select");
    DASHBOARD_ASPECT_RATIOS.forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      aspectRatioSelect.appendChild(option);
    });
    aspectRatioSelect.value = layout.aspectRatio;

    aspectField.appendChild(aspectLabel);
    aspectField.appendChild(aspectRatioSelect);

    aspectSection.appendChild(aspectField);

    const layoutSection = document.createElement("section");
    layoutSection.className = "plot-customize-section";

    const syncLabel = document.createElement("label");
    syncLabel.className = "plot-customize-checkbox";

    const syncToggle = document.createElement("input");
    syncToggle.type = "checkbox";
    syncToggle.checked = layout.syncSliders;

    const syncText = document.createElement("span");
    syncText.textContent = "Sync sliders for plots with a matching X axis";

    syncLabel.appendChild(syncToggle);
    syncLabel.appendChild(syncText);

    layoutSection.appendChild(compactLabel);
    layoutSection.appendChild(syncLabel);

    const interactionSection = document.createElement("section");
    interactionSection.className = "plot-customize-section";

    const hoverSyncLabel = document.createElement("label");
    hoverSyncLabel.className = "plot-customize-checkbox";

    const hoverSyncToggle = document.createElement("input");
    hoverSyncToggle.type = "checkbox";
    hoverSyncToggle.checked = layout.syncHover;

    const hoverSyncText = document.createElement("span");
    hoverSyncText.textContent = "Sync hover position for plots with a matching X axis";

    hoverSyncLabel.appendChild(hoverSyncToggle);
    hoverSyncLabel.appendChild(hoverSyncText);

    const hoverModeField = document.createElement("label");
    hoverModeField.className = "plot-customize-field";

    const hoverModeText = document.createElement("span");
    hoverModeText.className = "plot-customize-title";
    hoverModeText.textContent = "Hover mode";

    const hoverModeSelect = document.createElement("select");
    const hoverModeOptions = [
      { value: "x", label: "Vertical line" },
      { value: "x unified", label: "Unified vertical line" },
    ];
    for (const option of hoverModeOptions) {
      const hoverOption = document.createElement("option");
      hoverOption.value = option.value;
      hoverOption.textContent = option.label;
      hoverModeSelect.appendChild(hoverOption);
    }
    hoverModeSelect.value = layout.hoverMode;

    hoverModeField.appendChild(hoverModeText);
    hoverModeField.appendChild(hoverModeSelect);

    interactionSection.appendChild(hoverModeField);
    interactionSection.appendChild(hoverSyncLabel);

    customizeBody.appendChild(aspectSection);
    customizeBody.appendChild(layoutSection);
    customizeBody.appendChild(interactionSection);
    customizePanel.appendChild(customizeHeader);
    customizePanel.appendChild(customizeBody);

    const contentArea = document.createElement("div");
    contentArea.className = "dashboard-content";
    contentArea.appendChild(plotsGrid);
    contentArea.appendChild(customizeOverlay);
    contentArea.appendChild(customizePanel);

    panel.appendChild(header);
    panel.appendChild(warning);
    panel.appendChild(contentArea);

    cloneButton.addEventListener("click", () => {
      cloneDashboardForCurrentFile(dashboard);
    });

    function setCustomizeOpen(isOpen) {
      if (!isOpen && customizePanel.contains(document.activeElement)) {
        customizeButton.focus();
      }
      customizeOverlay.hidden = !isOpen;
      customizePanel.hidden = !isOpen;
      customizePanel.setAttribute("aria-hidden", String(!isOpen));
      customizeButton.setAttribute("aria-expanded", String(isOpen));
      customizeButton.innerHTML = isOpen ? icons.x : icons.settings;
      customizeButton.title = isOpen ? "Close" : "Customize";
      customizeOverlay.classList.toggle("is-open", isOpen);
      customizePanel.classList.toggle("is-open", isOpen);
    }

    async function resizeDashboardPlots() {
      const plotly = await loadPlotly();
      if (!plotly?.Plots?.resize) {
        return;
      }
      const canvases = plotsGrid.querySelectorAll(".dashboard-plot-canvas");
      await Promise.all(
        Array.from(canvases).map(async (canvas) => {
          try {
            await plotly.Plots.resize(canvas);
          } catch (error) {
            console.warn("Unable to resize dashboard plot.", error);
          }
        }),
      );
    }

    async function updateDashboardHoverMode() {
      const plotly = await loadPlotly();
      if (!plotly?.relayout) {
        return;
      }
      const hoverMode = layout.hoverMode;
      const showHoverSpikes = hoverMode === "x" || hoverMode === "x unified";
      for (const plot of dashboard.plots) {
        const entry = plotElements.get(plot.id);
        if (!entry?.canvas || entry.card.classList.contains("is-disabled")) {
          continue;
        }
        const hoverEnabled = plot.plotSettings?.hoverEnabled ?? true;
        try {
          await plotly.relayout(entry.canvas, {
            hovermode: hoverEnabled ? hoverMode : false,
            "xaxis.showspikes": hoverEnabled && showHoverSpikes,
            "xaxis.spikemode": hoverEnabled && showHoverSpikes ? "across" : null,
            "xaxis.spikesnap": hoverEnabled && showHoverSpikes ? "cursor" : null,
          });
        } catch (error) {
          console.warn("Unable to update hover mode for dashboard plot.", error);
        }
      }
    }

    async function rerenderDashboardPlots() {
      const renders = [];
      for (const plot of dashboard.plots) {
        const entry = plotElements.get(plot.id);
        if (!entry?.renderPlot || entry.card.classList.contains("is-disabled")) {
          continue;
        }
        renders.push(entry.renderPlot({ preserveSliceControls: true }));
      }
      if (renders.length) {
        await Promise.allSettled(renders);
      }
    }

    function setGridToggleActive(columns) {
      gridToggleButtons.forEach((button, value) => {
        const isActive = value === columns;
        button.classList.toggle("active", isActive);
        button.setAttribute("aria-selected", isActive ? "true" : "false");
      });
    }

    function updateGridColumns(value) {
      const columns = clampGridColumns(value);
      layout.gridColumns = columns;
      plotsGrid.dataset.columns = String(columns);
      setGridToggleActive(columns);
      persist();
      requestAnimationFrame(() => {
        void resizeDashboardPlots();
      });
    }

    function updateCompactMode(value) {
      layout.compactMode = Boolean(value);
      compactToggle.checked = layout.compactMode;
      plotsGrid.classList.toggle("is-compact", layout.compactMode);
      persist();
      void rerenderDashboardPlots();
      requestAnimationFrame(() => {
        void resizeDashboardPlots();
      });
    }

    customizeButton.addEventListener("click", () => {
      if (customizePanel.classList.contains("is-open")) {
        setCustomizeOpen(false);
      } else {
        setCustomizeOpen(true);
      }
    });

    customizeOverlay.addEventListener("click", () => {
      setCustomizeOpen(false);
    });

    customizeReset.addEventListener("click", () => {
      const defaults = DEFAULT_DASHBOARD_LAYOUT;
      layout.compactMode = defaults.compactMode;
      layout.aspectRatio = defaults.aspectRatio;
      layout.syncSliders = defaults.syncSliders;
      layout.syncHover = defaults.syncHover;
      layout.hoverMode = defaults.hoverMode;
      layout.gridColumns = defaults.gridColumns;
      compactToggle.checked = layout.compactMode;
      aspectRatioSelect.value = layout.aspectRatio;
      syncToggle.checked = layout.syncSliders;
      hoverSyncToggle.checked = layout.syncHover;
      hoverModeSelect.value = layout.hoverMode;
      plotsGrid.classList.toggle("is-compact", layout.compactMode);
      plotsGrid.dataset.columns = String(layout.gridColumns);
      setGridToggleActive(layout.gridColumns);
      persist();
      void rerenderDashboardPlots();
      void updateDashboardHoverMode();
      requestAnimationFrame(() => {
        void resizeDashboardPlots();
      });
    });

    gridToggleButtons.forEach((button, value) => {
      button.addEventListener("click", () => {
        updateGridColumns(value);
      });
    });

    setGridToggleActive(layout.gridColumns);

    compactToggle.addEventListener("change", (event) => {
      updateCompactMode(event.target.checked);
    });

    aspectRatioSelect.addEventListener("change", (event) => {
      layout.aspectRatio = normalizeAspectRatio(event.target.value);
      aspectRatioSelect.value = layout.aspectRatio;
      persist();
      void rerenderDashboardPlots();
      requestAnimationFrame(() => {
        void resizeDashboardPlots();
      });
    });

    syncToggle.addEventListener("change", (event) => {
      layout.syncSliders = event.target.checked;
      if (layout.syncSliders) {
        const preferredVisibility = dashboard.plots
          .map((plot) => plot.sliceControlsVisible)
          .find((value) => typeof value === "boolean");
        layout.sliderControlsVisible =
          typeof preferredVisibility === "boolean"
            ? preferredVisibility
            : DEFAULT_DASHBOARD_LAYOUT.sliderControlsVisible;
        dashboard.plots.forEach((plot) => {
          plot.sliceControlsVisible = layout.sliderControlsVisible;
        });
      }
      persist();
      updateDashboardSliderVisibility(dashboard.id);
    });

    hoverSyncToggle.addEventListener("change", (event) => {
      layout.syncHover = event.target.checked;
      persist();
      if (layout.syncHover) {
        void updateDashboardHoverMode();
      }
    });

    hoverModeSelect.addEventListener("change", (event) => {
      layout.hoverMode = normalizeHoverMode(event.target.value);
      hoverModeSelect.value = layout.hoverMode;
      persist();
      void updateDashboardHoverMode();
    });

    return {
      panel,
      warning,
      warningText,
      cloneButton,
      plotsGrid,
      customizeButton,
      customizeOverlay,
      customizePanel,
    };
  }

  function createPlotConfig() {
    return {
      id: createId(),
      xPath: "",
      yPath: "",
      yAxisPath: "",
      additionalYPaths: [],
      slicePath: "",
      colorbarPath: "",
      yMode: "1d",
      sliceAxis: 0,
      sliceIndex: 0,
      sliceControlsVisible: true,
      fileKey: null,
      fileLabel: null,
      plotSettings: null,
      plotOverrides: null,
    };
  }

  function renderPlotCard(dashboard, plot, container) {
    const layout = normalizeDashboardLayout(dashboard);
    const card = document.createElement("section");
    card.className = "dashboard-plot";

    const header = document.createElement("div");
    header.className = "dashboard-plot-header";

    const title = document.createElement("div");
    title.className = "dashboard-plot-title";
    const titleText = document.createElement("span");
    titleText.className = "dashboard-tab-text";
    const updateTitle = () => {
      titleText.textContent = getPlotTitle(plot);
    };
    updateTitle();
    title.appendChild(titleText);

    const actions = document.createElement("div");
    actions.className = "dashboard-plot-actions";

    const customizeButton = document.createElement("button");
    customizeButton.type = "button";
    customizeButton.className = "button button-secondary dashboard-tab-action";
    customizeButton.innerHTML = icons.pencil;
    customizeButton.setAttribute("aria-label", "Customize plot");
    customizeButton.title = "Customize plot";

    const addDatasetButton = document.createElement("button");
    addDatasetButton.type = "button";
    addDatasetButton.className = "button button-secondary dashboard-tab-action";
    addDatasetButton.innerHTML = icons.plus;
    addDatasetButton.setAttribute("aria-label", "Add dataset to plot");
    addDatasetButton.title = "Add dataset to plot";

    const sliderToggleButton = document.createElement("button");
    sliderToggleButton.type = "button";
    sliderToggleButton.className = "button button-secondary dashboard-tab-action";
    sliderToggleButton.innerHTML = icons.adjustments;
    sliderToggleButton.setAttribute("aria-label", "Hide slider");
    sliderToggleButton.title = "Hide slider";
    sliderToggleButton.hidden = true;
    sliderToggleButton.setAttribute("aria-pressed", "true");

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "button button-secondary dashboard-tab-action";
    removeButton.setAttribute("aria-label", "Remove plot");
    removeButton.title = "Remove plot";
    removeButton.innerHTML = icons.x;

    actions.appendChild(addDatasetButton);
    actions.appendChild(sliderToggleButton);
    actions.appendChild(customizeButton);
    actions.appendChild(removeButton);

    header.appendChild(title);
    header.appendChild(actions);

    const status = document.createElement("p");
    status.className = "dashboard-status";

    const error = document.createElement("p");
    error.className = "dashboard-error";
    header.insertBefore(error, title);

    const addDatasetPanel = document.createElement("div");
    addDatasetPanel.className = "dashboard-add-dataset";
    addDatasetPanel.hidden = true;

    const addDatasetLabel = document.createElement("label");
    addDatasetLabel.className = "dashboard-add-dataset-label";
    addDatasetLabel.textContent = "Add Y dataset";

    const addDatasetInput = document.createElement("input");
    addDatasetInput.type = "search";
    addDatasetInput.className = "dashboard-add-dataset-input";
    addDatasetInput.placeholder = "Select a dataset";
    const addDatasetListId = `dashboard-add-dataset-${plot.id}`;
    addDatasetInput.setAttribute("list", addDatasetListId);

    const addDatasetList = document.createElement("datalist");
    addDatasetList.id = addDatasetListId;

    addDatasetLabel.appendChild(addDatasetInput);
    addDatasetLabel.appendChild(addDatasetList);

    const addDatasetActions = document.createElement("div");
    addDatasetActions.className = "dashboard-add-dataset-actions";

    const addDatasetConfirm = document.createElement("button");
    addDatasetConfirm.type = "button";
    addDatasetConfirm.className = "button button-primary";
    addDatasetConfirm.textContent = "Add";

    const addDatasetCancel = document.createElement("button");
    addDatasetCancel.type = "button";
    addDatasetCancel.className = "button button-secondary";
    addDatasetCancel.textContent = "Cancel";

    addDatasetActions.appendChild(addDatasetConfirm);
    addDatasetActions.appendChild(addDatasetCancel);

    addDatasetPanel.appendChild(addDatasetLabel);
    addDatasetPanel.appendChild(addDatasetActions);

    const sliceControls = document.createElement("div");
    sliceControls.className = "plot-slice-controls";
    sliceControls.hidden = true;

    const sliceLabel = document.createElement("label");
    sliceLabel.className = "plot-slice-label";
    const sliceLabelText = document.createElement("span");
    sliceLabelText.textContent = "Slice";

    const sliceRange = document.createElement("input");
    sliceRange.type = "range";
    sliceRange.min = "0";
    sliceRange.max = "0";
    sliceRange.value = "0";

    const sliceNumber = document.createElement("input");
    sliceNumber.type = "number";
    sliceNumber.min = "0";
    sliceNumber.max = "0";
    sliceNumber.value = "0";
    sliceNumber.className = "plot-slice-input";

    sliceLabel.appendChild(sliceLabelText);
    sliceLabel.appendChild(sliceRange);
    sliceLabel.appendChild(sliceNumber);
    sliceControls.appendChild(sliceLabel);
    header.insertBefore(sliceControls, actions);

    const plotArea = document.createElement("div");
    plotArea.className = "dashboard-plot-area";

    const placeholder = document.createElement("p");
    placeholder.className = "dashboard-placeholder muted";
    placeholder.textContent = "Select datasets to render a plot.";

    const canvas = document.createElement("div");
    canvas.className = "dashboard-plot-canvas";

    plotArea.appendChild(placeholder);
    plotArea.appendChild(canvas);

    card.appendChild(header);
    card.appendChild(status);
    card.appendChild(addDatasetPanel);
    card.appendChild(plotArea);

    function setError(message) {
      error.textContent = message;
      error.hidden = !message;
    }

    function setStatus(message) {
      status.textContent = message;
      status.hidden = !message;
    }

    function setPlaceholder(message) {
      placeholder.textContent = message;
      placeholder.hidden = !message;
    }

    let addDatasetOptions = [];

    function getAdditionalYPaths() {
      return Array.isArray(plot.additionalYPaths) ? plot.additionalYPaths : [];
    }

    function setAddDatasetOpen(isOpen) {
      addDatasetPanel.hidden = !isOpen;
      if (!isOpen) {
        addDatasetInput.value = "";
      }
    }

    function updateAddDatasetAvailability() {
      const canAdd =
        plot.yMode === "1d" && Boolean(plot.fileKey) && Boolean(plot.yPath);
      addDatasetButton.disabled = !canAdd;
      if (!canAdd) {
        setAddDatasetOpen(false);
      }
    }

    function updateAddDatasetOptions(options) {
      addDatasetOptions = options;
      while (addDatasetList.firstChild) {
        addDatasetList.removeChild(addDatasetList.firstChild);
      }
      addDatasetOptions.forEach((dataset) => {
        const option = document.createElement("option");
        option.value = dataset.path;
        addDatasetList.appendChild(option);
      });
    }

    let sliceControlsAvailable = false;
    let sliceMaxIndex = 0;

    function resolveSliceControlsVisible() {
      if (layout.syncSliders) {
        return layout.sliderControlsVisible;
      }
      return plot.sliceControlsVisible ?? true;
    }

    function updateSliceToggleButton(isVisible) {
      sliderToggleButton.hidden = !sliceControlsAvailable;
      if (!sliceControlsAvailable) {
        return;
      }
      sliderToggleButton.setAttribute("aria-pressed", String(isVisible));
      sliderToggleButton.setAttribute(
        "aria-label",
        `${isVisible ? "Hide" : "Show"} slider`,
      );
      sliderToggleButton.title = `${isVisible ? "Hide" : "Show"} slider`;
    }

    function updateSliceControlsVisibility() {
      if (!sliceControlsAvailable) {
        sliceControls.hidden = true;
        sliceRange.disabled = true;
        sliceNumber.disabled = true;
        updateSliceToggleButton(false);
        return;
      }
      const isVisible = resolveSliceControlsVisible();
      sliceControls.hidden = !isVisible;
      if (!isVisible) {
        sliceRange.disabled = true;
        sliceNumber.disabled = true;
      } else {
        const shouldDisable = sliceMaxIndex <= 0;
        sliceRange.disabled = shouldDisable;
        sliceNumber.disabled = shouldDisable;
      }
      updateSliceToggleButton(isVisible);
    }

    function hideSliceControls() {
      sliceControlsAvailable = false;
      sliceMaxIndex = 0;
      sliceControls.hidden = true;
      sliceRange.disabled = true;
      sliceNumber.disabled = true;
      updateSliceControlsVisibility();
    }

    function updateSliceControls({ label, maxIndex, value }) {
      const safeMax = Math.max(maxIndex ?? 0, 0);
      const safeValue = clampIndex(value ?? 0, safeMax);
      sliceControlsAvailable = true;
      sliceMaxIndex = safeMax;
      sliceLabelText.textContent = label ?? "Slice";
      sliceRange.max = String(safeMax);
      sliceNumber.max = String(safeMax);
      sliceRange.value = String(safeValue);
      sliceNumber.value = String(safeValue);
      if (safeMax <= 0) {
        sliceRange.disabled = true;
        sliceNumber.disabled = true;
      } else {
        sliceRange.disabled = false;
        sliceNumber.disabled = false;
      }
      updateSliceControlsVisibility();
    }

    async function updatePlotModeFromDataset() {
      const dataset = plot.yPath
        ? await getDatasetByPath?.(plot.fileKey, plot.yPath)
        : null;
      if (!dataset) {
        plot.yMode = "1d";
        plot.sliceAxis = 0;
        plot.sliceIndex = 0;
        return;
      }

      const rank = dataset.shape?.length ?? 1;
      plot.yMode = rank >= 3 ? "heatmap" : rank === 2 ? "2d" : "1d";
      plot.sliceAxis = plot.sliceAxis ?? 0;
      plot.sliceIndex = plot.sliceIndex ?? 0;
    }

    let hoverSyncKey = null;

    async function updateHoverSyncKey(yDataset, xDataset, datasetOptions) {
      hoverSyncKey = await getHoverSyncKey(
        plot,
        yDataset,
        xDataset,
        datasetOptions,
      );
      const entry = plotElements.get(plot.id);
      if (entry) {
        entry.hoverSyncKey = hoverSyncKey;
      }
    }

    async function syncHoverToMatchingPlots(pointNumber, xval) {
      if (!dashboard.layout?.syncHover || isSyncingHover) {
        return;
      }
      const hasPointNumber = Number.isInteger(pointNumber);
      if ((!hasPointNumber && typeof xval === "undefined") || !hoverSyncKey) {
        return;
      }
      const plotly = await loadPlotly();
      if (!plotly?.Fx?.hover) {
        return;
      }
      isSyncingHover = true;
      try {
        for (const candidate of dashboard.plots) {
          if (candidate.id === plot.id) {
            continue;
          }
          const entry = plotElements.get(candidate.id);
          if (!entry?.canvas || entry.card.classList.contains("is-disabled")) {
            continue;
          }
          if (entry.hoverSyncKey !== hoverSyncKey) {
            continue;
          }
          const hoverEnabled = candidate.plotSettings?.hoverEnabled ?? true;
          if (!hoverEnabled) {
            continue;
          }
          const traceCount = Array.isArray(entry.canvas.data)
            ? entry.canvas.data.length
            : 0;
          if (!traceCount) {
            continue;
          }
          // Dispatch a synthetic mousemove on the remote plot's drag layer so
          // Plotly renders the full hover including the vertical cursor line.
          // Fx.hover() only draws the tooltip, not the spike/cursor line.
          if (typeof xval !== "undefined") {
            const xaxis = entry.canvas._fullLayout?.xaxis;
            const dragLayer = entry.canvas.querySelector(".nsewdrag");
            if (xaxis && dragLayer) {
              const xpx = xaxis.l2p(xval);
              const rect = dragLayer.getBoundingClientRect();
              dragLayer.dispatchEvent(new MouseEvent("mousemove", {
                bubbles: true,
                cancelable: true,
                clientX: rect.left + xpx,
                clientY: rect.top + rect.height / 2,
              }));
              continue;
            }
          }
          // Fallback: Fx.hover for pointNumber-only case (no xval available)
          const hoverPoints = Array.from({ length: traceCount }, (_, index) => {
            const hoverPoint = { curveNumber: index };
            if (hasPointNumber) {
              hoverPoint.pointNumber = pointNumber;
            }
            return hoverPoint;
          });
          plotly.Fx.hover(entry.canvas, hoverPoints);
        }
      } finally {
        isSyncingHover = false;
      }
    }

    async function clearHoverSync() {
      if (!dashboard.layout?.syncHover || isSyncingHover) {
        return;
      }
      if (!hoverSyncKey) {
        return;
      }
      const plotly = await loadPlotly();
      if (!plotly?.Fx?.unhover) {
        return;
      }
      isSyncingHover = true;
      try {
        for (const candidate of dashboard.plots) {
          if (candidate.id === plot.id) {
            continue;
          }
          const entry = plotElements.get(candidate.id);
          if (!entry?.canvas || entry.card.classList.contains("is-disabled")) {
            continue;
          }
          if (entry.hoverSyncKey !== hoverSyncKey) {
            continue;
          }
          plotly.Fx.unhover(entry.canvas);
        }
      } finally {
        isSyncingHover = false;
      }
    }

    function bindHoverSyncHandlers() {
      if (typeof canvas?.on !== "function") {
        return;
      }
      canvas.on("plotly_hover", (eventData) => {
        const firstPoint = eventData?.points?.[0];
        const pointNumber = firstPoint?.pointNumber;
        const xval = firstPoint?.x;
        if (!Number.isInteger(pointNumber) && typeof xval === "undefined") {
          return;
        }
        void syncHoverToMatchingPlots(pointNumber, xval);
      });
      canvas.on("plotly_unhover", () => {
        void clearHoverSync();
      });
    }

    let renderInFlight = null;
    let queuedRenderArgs = null;

    async function performRenderPlot({ preserveSliceControls = false } = {}) {
      if (!preserveSliceControls) {
        hideSliceControls();
      }
      ensurePlotFileBinding(dashboard, plot);
      updateTitle();
      const plotFileKey = plot.fileKey;
      const plotFileLabel = getPlotFileLabel(plot);
      const hasDatasetPaths = Boolean(plot.xPath || plot.yPath);
      if (!plotFileKey && hasDatasetPaths) {
        setError("[Re-open the file to render]");
        setPlaceholder("Select a file to re-link this plot.");
        updatePlotAvailability();
        updateDashboardWarning(dashboard);
        await disposePlot(canvas);
        return;
      }
      const datasetOptions = plotFileKey ? await getDatasetOptions(plotFileKey) : [];
      if (plotFileKey && !datasetOptions.length) {
        setError("[Re-open the file to render]");
        setPlaceholder("Select a file to re-link this plot.");
        updatePlotAvailability();
        updateDashboardWarning(dashboard);
        await disposePlot(canvas);
        return;
      }
      const session = await getSession?.(plotFileKey, plotFileLabel);
      await updatePlotModeFromDataset();
      persist();
      updateAddDatasetAvailability();
      if (plot.yMode === "1d") {
        hideSliceControls();
      }
      if (!session) {
        const fileMessage = plotFileKey
          ? `Open ${plotFileLabel} to render this plot.`
          : "Open an HDF5 file to render a plot.";
        setError(fileMessage);
        setPlaceholder(
          plotFileKey
            ? `Open ${plotFileLabel} to choose datasets.`
            : "Open an HDF5 file to choose datasets.",
        );
        await disposePlot(canvas);
        return;
      }
      updatePlotAvailability();
      updateDashboardWarning(dashboard);

      if (!plot.yPath) {
        await disposePlot(canvas);
        return;
      }

      const yDataset = await getDatasetByPath?.(plotFileKey, plot.yPath);
      if (!yDataset) {
        setError("Selected Y dataset was not found.");
        setPlaceholder("Select a dataset to render a plot.");
        await disposePlot(canvas);
        return;
      }
      const sliceDataset = plot.slicePath
        ? await getDatasetByPath?.(plotFileKey, plot.slicePath)
        : null;
      const colorbarDataset = plot.colorbarPath
        ? await getDatasetByPath?.(plotFileKey, plot.colorbarPath)
        : null;

      await loadPlotly();
      setError("");

      let activeSession = session;
      let refreshAttempted = false;

      const showStaleSessionError = async () => {
        setError("This file session is stale. Please reopen or relink the file.");
        setStatus("");
        setPlaceholder("Reopen or relink the file to refresh the plot.");
        hideSliceControls();
        await disposePlot(canvas);
      };

      const renderWithSession = async () => {
        try {
          try {
            await activeSession.listChildren("/");
          } catch (error) {
            if (!refreshAttempted && plotFileKey) {
              refreshAttempted = true;
              const refreshedSession = await getSession?.(
                plotFileKey,
                plotFileLabel,
              );
              if (!refreshedSession) {
                await showStaleSessionError();
                return;
              }
              activeSession = refreshedSession;
              return renderWithSession();
            }
            await showStaleSessionError();
            return;
          }
          await disposePlot(canvas);
          const plotMode = plot.yMode;
          const baseSettings = {
            ...createDefaultPlotSettings(),
            ...(plot.plotSettings ?? {}),
          };
          const aspectRatio =
            layout?.aspectRatio ?? DEFAULT_DASHBOARD_LAYOUT.aspectRatio;
          if (aspectRatio) {
            baseSettings.aspectRatio = aspectRatio;
          }
          const plotTitle = getPlotTitle(plot);
          let yValues = [];
          let xValues = null;
          let yLength = 0;
          let xDataset = null;
          let xLength = null;
          let additionalSeries = [];
          let additionalSeriesErrors = [];
          let renderStatusMessage = "";
          let resolvedSliceAxis = Number.isInteger(plot.sliceAxis)
            ? plot.sliceAxis
            : 0;
          let defaultAxisRange = null;
          let defaultAxisStep = 1;
          const maxPoints = resolvePositiveInteger(baseSettings.maxPoints, 100000);
          const maxRows = resolvePositiveInteger(baseSettings.maxRows, 1000);
          const maxCols = resolvePositiveInteger(baseSettings.maxCols, 1000);
          const decimationStep = resolvePositiveInteger(
            baseSettings.decimationStep,
            1,
          );

          if (plot.xPath) {
            xDataset = await getDatasetByPath?.(plotFileKey, plot.xPath);
            if (!isNumeric1D(xDataset)) {
              throw new Error("X dataset must be a numeric 1D array.");
            }
            xLength = xDataset.shape?.[0] ?? 0;
          }

          if (plotMode === "heatmap") {
            if (!isNumericDtype(yDataset.dtype)) {
              throw new Error("Y dataset must be numeric.");
            }

            const shape = yDataset.shape ?? [];
            const rowCount = shape[shape.length - 2] ?? 0;
            const colCount = shape[shape.length - 1] ?? 0;
            const rowRange = resolveIndexRange(rowCount, baseSettings, "y");
            const colRange = resolveIndexRange(colCount, baseSettings, "x");
            const rowSpan = Math.max(rowRange.end - rowRange.start, 0);
            const colSpan = Math.max(colRange.end - colRange.start, 0);
            const rowStep = resolveSamplingStep(
              rowSpan,
              maxRows,
              decimationStep,
            );
            const colStep = resolveSamplingStep(
              colSpan,
              maxCols,
              decimationStep,
            );
            const leadingDims = shape.slice(0, -2);
            const axisCount = leadingDims.length;
            if (sliceDataset && isNumeric1D(sliceDataset)) {
              const sliceLength = sliceDataset.shape?.[0] ?? 0;
              const sliceAxisIndex = leadingDims.findIndex(
                (dimension) => dimension === sliceLength,
              );
              if (sliceAxisIndex >= 0) {
                resolvedSliceAxis = sliceAxisIndex;
              }
            }
            const safeAxis =
              axisCount > 0
                ? Math.min(Math.max(resolvedSliceAxis, 0), axisCount - 1)
                : 0;
            const maxIndex = Math.max((shape[safeAxis] ?? 1) - 1, 0);
            const clampedIndex = clampIndex(plot.sliceIndex ?? 0, maxIndex);
            const leadingIndices = leadingDims.map(() => 0);
            if (leadingIndices.length) {
              leadingIndices[safeAxis] = clampedIndex;
            }
            plot.sliceAxis = safeAxis;
            plot.sliceIndex = clampedIndex;

            let xAxisValues = null;
            let yAxisValues = null;
            let rAxis = null;

            if (xDataset) {
              if (xLength !== colCount) {
                throw new Error("X dataset length must match R dimension.");
              }
              const xResult = await readDatasetWithCache({
                fileKey: plotFileKey,
                datasetPath: plot.xPath,
                operation: "readDataset1D",
                params: {
                  start: colRange.start,
                  end: colRange.end,
                  maxPoints: maxCols,
                  step: colStep,
                },
                reader: () =>
                  activeSession.readDataset1D(plot.xPath, {
                    start: colRange.start,
                    end: colRange.end,
                    maxPoints: maxCols,
                    step: colStep,
                  }),
              });
              xAxisValues = xResult.values;
            } else {
              rAxis =
                findAxisDatasetByName(
                  await getDatasetOptions(plotFileKey),
                  yDataset.parentPath,
                  "r",
                  colCount,
                ) ??
                findAxisDatasetByName(
                  await getDatasetOptions(plotFileKey),
                  yDataset.parentPath,
                  "dim2",
                  colCount,
                );
              if (rAxis) {
                const rResult = await readDatasetWithCache({
                  fileKey: plotFileKey,
                  datasetPath: rAxis.path,
                  operation: "readDataset1D",
                  params: {
                    start: colRange.start,
                    end: colRange.end,
                    maxPoints: maxCols,
                    step: colStep,
                  },
                  reader: () =>
                    activeSession.readDataset1D(rAxis.path, {
                      start: colRange.start,
                      end: colRange.end,
                      maxPoints: maxCols,
                      step: colStep,
                    }),
                });
                xAxisValues = rResult.values;
              }
            }

            const datasetOptions = await getDatasetOptions(plotFileKey);
            const zAxisFromPath = plot.yAxisPath
              ? datasetOptions.find((d) => d.path === plot.yAxisPath)
              : null;
            const zAxis =
              zAxisFromPath ??
              findAxisDatasetByName(
                datasetOptions,
                yDataset.parentPath,
                "z",
                rowCount,
              ) ??
              findAxisDatasetByName(
                datasetOptions,
                yDataset.parentPath,
                "dim1",
                rowCount,
              );
            if (zAxis) {
              const zResult = await readDatasetWithCache({
                fileKey: plotFileKey,
                datasetPath: zAxis.path,
                operation: "readDataset1D",
                params: {
                  start: rowRange.start,
                  end: rowRange.end,
                  maxPoints: maxRows,
                  step: rowStep,
                },
                reader: () =>
                  activeSession.readDataset1D(zAxis.path, {
                    start: rowRange.start,
                    end: rowRange.end,
                    maxPoints: maxRows,
                    step: rowStep,
                  }),
              });
              yAxisValues = zResult.values;
            }

            let zValues = [];
            if (shape.length === 3) {
              const frameResult = await readDatasetWithCache({
                fileKey: plotFileKey,
                datasetPath: plot.yPath,
                operation: "readDataset3DFrame",
                params: {
                  tIndex: clampedIndex,
                  rowStart: rowRange.start,
                  rowEnd: rowRange.end,
                  colStart: colRange.start,
                  colEnd: colRange.end,
                  maxRows,
                  maxCols,
                  rowStep,
                  colStep,
                },
                reader: () =>
                  activeSession.readDataset3DFrame(plot.yPath, {
                    tIndex: clampedIndex,
                    rowStart: rowRange.start,
                    rowEnd: rowRange.end,
                    colStart: colRange.start,
                    colEnd: colRange.end,
                    maxRows,
                    maxCols,
                    rowStep,
                    colStep,
                  }),
              });
              zValues = frameResult.values;
            } else {
              const heatmapResult = await readDatasetWithCache({
                fileKey: plotFileKey,
                datasetPath: plot.yPath,
                operation: "readDatasetND2D",
                params: {
                  leadingIndices,
                  rowStart: rowRange.start,
                  rowEnd: rowRange.end,
                  colStart: colRange.start,
                  colEnd: colRange.end,
                  maxRows,
                  maxCols,
                  rowStep,
                  colStep,
                },
                reader: () =>
                  activeSession.readDatasetND2D(plot.yPath, {
                    leadingIndices,
                    rowStart: rowRange.start,
                    rowEnd: rowRange.end,
                    colStart: colRange.start,
                    colEnd: colRange.end,
                    maxRows,
                    maxCols,
                    rowStep,
                    colStep,
                  }),
              });
              zValues = heatmapResult.values;
            }

            const fallbackCols = zValues[0]?.length ?? 0;
            const fallbackRows = zValues.length ?? 0;
            const hasAxisData =
              (xDataset && zAxis) ||
              (rAxis && zAxis) ||
              (xAxisValues && yAxisValues);
            const scaleMode = baseSettings.scaleMode || "auto";

            let shouldEnforceEqualScale = false;
            if (scaleMode === "equal") {
              shouldEnforceEqualScale = true;
            } else if (scaleMode === "auto" && hasAxisData) {
              // Smart default: only enforce equal scaling if aspect ratio is reasonable
              const aspectRatio = Math.max(rowCount, colCount) / Math.min(rowCount, colCount);
              shouldEnforceEqualScale = aspectRatio <= 3;
            }
            // scaleMode === "free" means never enforce equal scaling

            const heatmapPlotSettings = shouldEnforceEqualScale
              ? { ...baseSettings, aspectRatio: "1:1", equalScale: true }
              : baseSettings;
            await renderHeatmapPlot(
              canvas,
              xAxisValues ??
                Array.from(
                  { length: fallbackCols },
                  (_, i) => colRange.start + i * colStep,
                ),
              yAxisValues ??
                Array.from(
                  { length: fallbackRows },
                  (_, i) => rowRange.start + i * rowStep,
                ),
              zValues,
              {
                xLabel: xAxisValues ? xDataset?.path ?? rAxis?.path ?? "R" : "R Index",
                yLabel: yAxisValues ? zAxis?.path ?? "Z" : "Z Index",
                zLabel: colorbarDataset?.path ?? plot.yPath,
                plotSettings: heatmapPlotSettings,
                plotOverrides: buildDashboardPlotOverrides(
                  dashboard,
                  plot,
                  heatmapPlotSettings,
                ),
              },
            );
            updateSliceControls({
              label: sliceDataset
                ? `${sliceDataset.name ?? sliceDataset.path}`
                : "Slice index",
              maxIndex,
              value: clampedIndex,
            });
            setStatus("");
            return;
          }

          if (plotMode === "2d") {
            if (!isNumericDtype(yDataset.dtype)) {
              throw new Error("Y dataset must be numeric.");
            }

            const [rows = 0, cols = 0] = yDataset.shape ?? [];
            if (sliceDataset && isNumeric1D(sliceDataset)) {
              const sliceLength = sliceDataset.shape?.[0] ?? 0;
              if (sliceLength === rows) {
                resolvedSliceAxis = 0;
              } else if (sliceLength === cols) {
                resolvedSliceAxis = 1;
              }
            }
            if (xLength !== null) {
              if (xLength === rows && xLength !== cols) {
                resolvedSliceAxis = 1;
              } else if (xLength === cols && xLength !== rows) {
                resolvedSliceAxis = 0;
              }
            }
            const maxIndex = Math.max(
              (resolvedSliceAxis === 1 ? cols : rows) - 1,
              0,
            );
            const clampedIndex = clampIndex(plot.sliceIndex ?? 0, maxIndex);
            plot.sliceAxis = resolvedSliceAxis;
            plot.sliceIndex = clampedIndex;

            let candidateAxes = [resolvedSliceAxis];
            if (xLength !== null) {
              const axisCandidates = [];
              if (xLength === rows) {
                axisCandidates.push(1);
              }
              if (xLength === cols) {
                axisCandidates.push(0);
              }
              if (axisCandidates.length === 0) {
                throw new Error("X and Y datasets must have the same length.");
              }
              candidateAxes = [
                axisCandidates.includes(resolvedSliceAxis)
                  ? resolvedSliceAxis
                  : axisCandidates[0],
                ...axisCandidates.filter((axis) => axis !== resolvedSliceAxis),
              ];
            }

            let aligned = false;
            let lastLengthMismatch = false;
            for (const axis of candidateAxes) {
              yLength = axis === 1 ? rows : cols;
              const axisRange = resolveIndexRange(yLength, baseSettings, "x");
              const axisSpan = Math.max(axisRange.end - axisRange.start, 0);
              const axisStep = resolveSamplingStep(
                axisSpan,
                maxPoints,
                decimationStep,
              );
              const maxSliceIndex = Math.max((axis === 1 ? cols : rows) - 1, 0);
              const nextIndex = clampIndex(plot.sliceIndex ?? 0, maxSliceIndex);
              const yResult =
                axis === 1
                  ? await readDatasetWithCache({
                      fileKey: plotFileKey,
                      datasetPath: plot.yPath,
                      operation: "readDataset2DColumn",
                      params: {
                        colIndex: nextIndex,
                        rowStart: axisRange.start,
                        rowEnd: axisRange.end,
                        maxRows: maxPoints,
                        step: axisStep,
                      },
                      reader: () =>
                        activeSession.readDataset2DColumn(plot.yPath, {
                          colIndex: nextIndex,
                          rowStart: axisRange.start,
                          rowEnd: axisRange.end,
                          maxRows: maxPoints,
                          step: axisStep,
                        }),
                    })
                  : await readDatasetWithCache({
                      fileKey: plotFileKey,
                      datasetPath: plot.yPath,
                      operation: "readDataset2DRow",
                      params: {
                        rowIndex: nextIndex,
                        colStart: axisRange.start,
                        colEnd: axisRange.end,
                        maxCols: maxPoints,
                        step: axisStep,
                      },
                      reader: () =>
                        activeSession.readDataset2DRow(plot.yPath, {
                          rowIndex: nextIndex,
                          colStart: axisRange.start,
                          colEnd: axisRange.end,
                          maxCols: maxPoints,
                          step: axisStep,
                        }),
                    });
              yValues = yResult.values;

              if (plot.xPath) {
                if ((xDataset.shape?.[0] ?? 0) !== yLength) {
                  lastLengthMismatch = true;
                  continue;
                }
                const xResult = await readDatasetWithCache({
                  fileKey: plotFileKey,
                  datasetPath: plot.xPath,
                  operation: "readDataset1D",
                  params: {
                    start: axisRange.start,
                    end: axisRange.end,
                    maxPoints,
                    step: axisStep,
                  },
                  reader: () =>
                    activeSession.readDataset1D(plot.xPath, {
                      start: axisRange.start,
                      end: axisRange.end,
                      maxPoints,
                      step: axisStep,
                    }),
                });
                xValues = xResult.values;
              }

              const alignedX =
                xValues ??
                yValues.map(
                  (_, index) => axisRange.start + index * axisStep,
                );
              if (alignedX.length === yValues.length) {
                aligned = true;
                xValues = alignedX;
                break;
              }

              xValues = null;
            }

            if (!aligned) {
              if (lastLengthMismatch) {
                throw new Error("X and Y datasets must have the same length.");
              }
              throw new Error("X and Y datasets could not be aligned.");
            }

            updateSliceControls({
              label: sliceDataset
                ? sliceDataset.name ?? sliceDataset.path
                : "Slice",
              maxIndex,
              value: clampedIndex,
            });
          } else {
            if (!isNumeric1D(yDataset)) {
              throw new Error("Y dataset must be a numeric 1D array.");
            }
            yLength = yDataset.shape?.[0] ?? 0;
            const axisRange = resolveIndexRange(yLength, baseSettings, "x");
            const axisSpan = Math.max(axisRange.end - axisRange.start, 0);
            const axisStep = resolveSamplingStep(
              axisSpan,
              maxPoints,
              decimationStep,
            );
            defaultAxisRange = axisRange;
            defaultAxisStep = axisStep;
            const yResult = await readDatasetWithCache({
              fileKey: plotFileKey,
              datasetPath: plot.yPath,
              operation: "readDataset1D",
              params: {
                start: axisRange.start,
                end: axisRange.end,
                maxPoints,
                step: axisStep,
              },
              reader: () =>
                activeSession.readDataset1D(plot.yPath, {
                  start: axisRange.start,
                  end: axisRange.end,
                  maxPoints,
                  step: axisStep,
                }),
            });
            yValues = yResult.values;

            const extraPaths = getAdditionalYPaths().filter(
              (path) => path && path !== plot.yPath,
            );
            if (extraPaths.length) {
              for (const path of extraPaths) {
                const extraDataset = await getDatasetByPath?.(
                  plotFileKey,
                  path,
                );
                if (!extraDataset) {
                  additionalSeriesErrors.push(path);
                  continue;
                }
                if (!isNumeric1D(extraDataset)) {
                  additionalSeriesErrors.push(path);
                  continue;
                }
                const extraLength = extraDataset.shape?.[0] ?? 0;
                if (extraLength !== yLength) {
                  additionalSeriesErrors.push(path);
                  continue;
                }
                const extraResult = await readDatasetWithCache({
                  fileKey: plotFileKey,
                  datasetPath: path,
                  operation: "readDataset1D",
                  params: {
                    start: axisRange.start,
                    end: axisRange.end,
                    maxPoints,
                    step: axisStep,
                  },
                  reader: () =>
                    activeSession.readDataset1D(path, {
                      start: axisRange.start,
                      end: axisRange.end,
                      maxPoints,
                      step: axisStep,
                    }),
                });
                additionalSeries.push({
                  path,
                  values: extraResult.values,
                });
              }
            }
          }

          if (plotMode !== "2d") {
            if (plot.xPath) {
              if ((xDataset.shape?.[0] ?? 0) !== yLength) {
                throw new Error("X and Y datasets must have the same length.");
              }
              const axisRange = resolveIndexRange(yLength, baseSettings, "x");
              const axisSpan = Math.max(axisRange.end - axisRange.start, 0);
              const axisStep = resolveSamplingStep(
                axisSpan,
                maxPoints,
                decimationStep,
              );
              const xResult = await readDatasetWithCache({
                fileKey: plotFileKey,
                datasetPath: plot.xPath,
                operation: "readDataset1D",
                params: {
                  start: axisRange.start,
                  end: axisRange.end,
                  maxPoints,
                  step: axisStep,
                },
                reader: () =>
                  activeSession.readDataset1D(plot.xPath, {
                    start: axisRange.start,
                    end: axisRange.end,
                    maxPoints,
                    step: axisStep,
                  }),
              });
              xValues = xResult.values;
            }

            const finalX =
              xValues ??
              yValues.map((_, index) => {
                if (defaultAxisRange) {
                  return defaultAxisRange.start + index * defaultAxisStep;
                }
                return index;
              });
            if (finalX.length !== yValues.length) {
              throw new Error("X and Y datasets could not be aligned.");
            }
            xValues = finalX;
          }

          const plotOverrides = buildDashboardPlotOverrides(
            dashboard,
            plot,
            baseSettings,
          );
          if (plotMode === "1d") {
            const primaryName =
              plot.plotSettings?.traceName?.trim() ||
              yDataset?.path ||
              plot.yPath;
            const series = [
              { x: xValues, y: yValues, name: primaryName },
              ...additionalSeries.map((entry) => ({
                x: xValues,
                y: entry.values,
                name: entry.path,
              })),
            ];
            await renderXYPlotSeries(canvas, series, {
              xLabel: plot.xPath ? plot.xPath : "Index",
              yLabel: plot.yPath,
              plotSettings: baseSettings,
              plotOverrides,
            });
          } else {
            await renderXYPlot(canvas, xValues, yValues, {
              xLabel: plot.xPath ? plot.xPath : "Index",
              yLabel: plot.yPath,
              plotSettings: baseSettings,
              plotOverrides,
            });
          }
          await updateHoverSyncKey(yDataset, xDataset, datasetOptions);
          bindHoverSyncHandlers();
          if (plotMode !== "2d") {
            hideSliceControls();
          }
          if (additionalSeriesErrors.length) {
            renderStatusMessage =
              "Some additional datasets could not be added to this plot.";
          }
          setStatus(renderStatusMessage);
          setError("");
          setPlaceholder("");
        } catch (error) {
          if (isInvalidIdentifierError(error)) {
            if (!refreshAttempted && plotFileKey) {
              refreshAttempted = true;
              const refreshedSession = await getSession?.(
                plotFileKey,
                plotFileLabel,
              );
              if (!refreshedSession) {
                await showStaleSessionError();
                return;
              }
              activeSession = refreshedSession;
              return renderWithSession();
            }
            await showStaleSessionError();
            return;
          }
          throw error;
        }
      };

      try {
        await renderWithSession();
      } catch (error) {
        setError(error.message);
        setStatus("");
        setPlaceholder("Unable to render the selected datasets.");
        hideSliceControls();
        await disposePlot(canvas);
      }
    }

    async function renderPlot({ preserveSliceControls = false } = {}) {
      const nextArgs = { preserveSliceControls };
      if (renderInFlight) {
        queuedRenderArgs = nextArgs;
        return renderInFlight;
      }
      queuedRenderArgs = null;
      renderInFlight = (async () => {
        await performRenderPlot(nextArgs);
      })();
      try {
        return await renderInFlight;
      } finally {
        renderInFlight = null;
        if (queuedRenderArgs) {
          const rerunArgs = queuedRenderArgs;
          queuedRenderArgs = null;
          renderPlot(rerunArgs);
        }
      }
    }

    removeButton.addEventListener("click", () => {
      dashboard.plots = dashboard.plots.filter((entry) => entry.id !== plot.id);
      plotElements.delete(plot.id);
      container.removeChild(card);
      clearDatasetSliceCache();
      persist();
      updateDashboardWarning(dashboard);
    });

    customizeButton.addEventListener("click", () => {
      onCustomizePlot?.(dashboard, plot);
    });

    sliderToggleButton.addEventListener("click", () => {
      const nextVisible = !resolveSliceControlsVisible();
      if (layout.syncSliders) {
        layout.sliderControlsVisible = nextVisible;
        dashboard.plots.forEach((entry) => {
          entry.sliceControlsVisible = nextVisible;
        });
        persist();
        updateDashboardSliderVisibility(dashboard.id);
        return;
      }
      plot.sliceControlsVisible = nextVisible;
      persist();
      updateSliceControlsVisibility();
    });

    async function openAddDatasetPicker() {
      if (!plot.fileKey) {
        setError("Re-link this plot to a file to add datasets.");
        return;
      }
      await updatePlotModeFromDataset();
      updateAddDatasetAvailability();
      if (plot.yMode !== "1d") {
        return;
      }
      if (!plot.yPath) {
        setError("Select a Y dataset to add another.");
        return;
      }
      const datasetOptions = await getDatasetOptions(plot.fileKey);
      const selectedPaths = new Set([plot.yPath, ...getAdditionalYPaths()]);
      const candidates = datasetOptions.filter(
        (dataset) => isNumeric1D(dataset) && !selectedPaths.has(dataset.path),
      );
      updateAddDatasetOptions(candidates);
      setError("");
      setAddDatasetOpen(true);
      addDatasetInput.focus();
    }

    async function confirmAddDataset() {
      const nextPath = addDatasetInput.value.trim();
      if (!nextPath) {
        setError("Select a dataset to add.");
        return;
      }
      const candidate = addDatasetOptions.find(
        (dataset) => dataset.path === nextPath,
      );
      if (!candidate) {
        setError("Select a dataset from the list.");
        return;
      }
      if (!isNumeric1D(candidate)) {
        setError("Y dataset must be a numeric 1D array.");
        return;
      }
      const additionalPaths = getAdditionalYPaths();
      if (additionalPaths.includes(nextPath) || plot.yPath === nextPath) {
        setError("That dataset is already in the plot.");
        return;
      }
      const baseDataset = plot.yPath
        ? await getDatasetByPath?.(plot.fileKey, plot.yPath)
        : null;
      const baseLength = baseDataset?.shape?.[0] ?? null;
      const candidateLength = candidate.shape?.[0] ?? null;
      if (
        baseLength !== null &&
        candidateLength !== null &&
        baseLength !== candidateLength
      ) {
        setError("Y dataset length must match the current plot.");
        return;
      }
      plot.additionalYPaths = [...additionalPaths, nextPath];
      persist();
      setAddDatasetOpen(false);
      setError("");
      setStatus("");
      renderPlot();
    }

    addDatasetButton.addEventListener("click", () => {
      if (addDatasetPanel.hidden) {
        void openAddDatasetPicker();
      } else {
        setAddDatasetOpen(false);
      }
    });

    addDatasetConfirm.addEventListener("click", () => {
      void confirmAddDataset();
    });

    addDatasetCancel.addEventListener("click", () => {
      setAddDatasetOpen(false);
    });

    addDatasetInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        void confirmAddDataset();
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setAddDatasetOpen(false);
      }
    });

    sliceRange.addEventListener("input", async (event) => {
      const maxIndex = Number.parseInt(sliceRange.max, 10);
      plot.sliceIndex = clampIndex(event.target.value, maxIndex);
      sliceNumber.value = String(plot.sliceIndex);
      persist();
      renderPlot({ preserveSliceControls: true });
      if (!dashboard.layout?.syncSliders || isSyncingSliders) {
        return;
      }
      isSyncingSliders = true;
      try {
        const yDataset = plot.yPath
          ? await getDatasetByPath?.(plot.fileKey, plot.yPath)
          : null;
        if (!yDataset) {
          return;
        }
        const datasetsCache = new Map();
        const sourceOptions = await getDatasetOptions(plot.fileKey);
        datasetsCache.set(plot.fileKey, sourceOptions);
        const sourceKey = await getSliceSyncKey(plot, yDataset, sourceOptions);
        for (const candidate of dashboard.plots) {
          if (candidate.id === plot.id) {
            continue;
          }
          const entry = plotElements.get(candidate.id);
          if (!entry?.sliceRange || !entry.sliceNumber || !entry.renderPlot) {
            continue;
          }
          if (!candidate.yPath) {
            continue;
          }
          const candidateDataset = await getDatasetByPath?.(
            candidate.fileKey,
            candidate.yPath,
          );
          if (!candidateDataset) {
            continue;
          }
          let candidateOptions = datasetsCache.get(candidate.fileKey);
          if (!candidateOptions) {
            candidateOptions = await getDatasetOptions(candidate.fileKey);
            datasetsCache.set(candidate.fileKey, candidateOptions);
          }
          const candidateKey = await getSliceSyncKey(
            candidate,
            candidateDataset,
            candidateOptions,
          );
          if (candidateKey !== sourceKey) {
            continue;
          }
          let candidateMax = Number.parseInt(entry.sliceRange.max, 10);
          if (Number.isNaN(candidateMax)) {
            candidateMax = getMaxSliceIndex(
              candidateDataset,
              candidate.yMode,
              candidate.sliceAxis,
            );
            entry.sliceRange.max = String(candidateMax);
            entry.sliceNumber.max = String(candidateMax);
          }
          candidate.sliceIndex = clampIndex(plot.sliceIndex, candidateMax);
          entry.sliceRange.value = String(candidate.sliceIndex);
          entry.sliceNumber.value = String(candidate.sliceIndex);
          entry.renderPlot({ preserveSliceControls: true });
        }
      } finally {
        isSyncingSliders = false;
      }
    });

    sliceNumber.addEventListener("change", async (event) => {
      const maxIndex = Number.parseInt(sliceNumber.max, 10);
      plot.sliceIndex = clampIndex(event.target.value, maxIndex);
      sliceRange.value = String(plot.sliceIndex);
      persist();
      renderPlot({ preserveSliceControls: true });
      if (!dashboard.layout?.syncSliders || isSyncingSliders) {
        return;
      }
      isSyncingSliders = true;
      try {
        const yDataset = plot.yPath
          ? await getDatasetByPath?.(plot.fileKey, plot.yPath)
          : null;
        if (!yDataset) {
          return;
        }
        const datasetsCache = new Map();
        const sourceOptions = await getDatasetOptions(plot.fileKey);
        datasetsCache.set(plot.fileKey, sourceOptions);
        const sourceKey = await getSliceSyncKey(plot, yDataset, sourceOptions);
        for (const candidate of dashboard.plots) {
          if (candidate.id === plot.id) {
            continue;
          }
          const entry = plotElements.get(candidate.id);
          if (!entry?.sliceRange || !entry.sliceNumber || !entry.renderPlot) {
            continue;
          }
          if (!candidate.yPath) {
            continue;
          }
          const candidateDataset = await getDatasetByPath?.(
            candidate.fileKey,
            candidate.yPath,
          );
          if (!candidateDataset) {
            continue;
          }
          let candidateOptions = datasetsCache.get(candidate.fileKey);
          if (!candidateOptions) {
            candidateOptions = await getDatasetOptions(candidate.fileKey);
            datasetsCache.set(candidate.fileKey, candidateOptions);
          }
          const candidateKey = await getSliceSyncKey(
            candidate,
            candidateDataset,
            candidateOptions,
          );
          if (candidateKey !== sourceKey) {
            continue;
          }
          let candidateMax = Number.parseInt(entry.sliceNumber.max, 10);
          if (Number.isNaN(candidateMax)) {
            candidateMax = getMaxSliceIndex(
              candidateDataset,
              candidate.yMode,
              candidate.sliceAxis,
            );
            entry.sliceRange.max = String(candidateMax);
            entry.sliceNumber.max = String(candidateMax);
          }
          candidate.sliceIndex = clampIndex(plot.sliceIndex, candidateMax);
          entry.sliceRange.value = String(candidate.sliceIndex);
          entry.sliceNumber.value = String(candidate.sliceIndex);
          entry.renderPlot({ preserveSliceControls: true });
        }
      } finally {
        isSyncingSliders = false;
      }
    });

    plotElements.set(plot.id, {
      card,
      canvas,
      plot,
      dashboardId: dashboard.id,
      title,
      updateTitle,
      customizeButton,
      sliceRange,
      sliceNumber,
      renderPlot,
      hoverSyncKey,
      setDisabled: (isDisabled, fileLabel) => {
        card.classList.toggle("is-disabled", isDisabled);
        removeButton.disabled = isDisabled;
        customizeButton.disabled = isDisabled;
        addDatasetButton.disabled = isDisabled;
        sliderToggleButton.disabled = isDisabled;
        if (isDisabled) {
          setAddDatasetOpen(false);
        }
        if (isDisabled) {
          setError("");
          setStatus("");
          setPlaceholder(
            `Open ${fileLabel || "the linked file"} to view this plot.`,
          );
        } else {
          setPlaceholder("");
        }
      },
      updateSliceControlsVisibility,
    });

    updatePlotModeFromDataset();
    renderPlot();

    return card;
  }

  function getMaxSliceIndex(dataset, mode, axis) {
    if (!dataset || !Array.isArray(dataset.shape)) {
      return 0;
    }
    if (mode === "heatmap") {
      const length = dataset.shape[axis] ?? 0;
      return Math.max(length - 1, 0);
    }
    if (mode === "2d") {
      const [rows = 0, cols = 0] = dataset.shape ?? [];
      return Math.max((axis === 1 ? cols : rows) - 1, 0);
    }
    return 0;
  }

  function createDashboard(name) {
    return {
      id: createId(),
      name,
      fileKey: currentFileKey ?? null,
      fileLabel: currentFileLabel || null,
      layout: { ...DEFAULT_DASHBOARD_LAYOUT },
      plots: [],
    };
  }

  function renderDashboards() {
    tabList.querySelectorAll(".dashboard-tab").forEach((wrapper) => {
      wrapper.remove();
    });

    panelContainer.innerHTML = "";
    plotElements.clear();
    dashboardElements.clear();

    dashboards.forEach((dashboard) => {
      const tabElements = renderTabButton(dashboard);
      if (addButton) {
        tabList.insertBefore(tabElements.wrapper, addButton);
      } else {
        tabList.appendChild(tabElements.wrapper);
      }

      const panelElements = renderDashboardPanel(dashboard);
      panelContainer.appendChild(panelElements.panel);

      dashboard.plots.forEach((plot) => {
        ensurePlotFileBinding(dashboard, plot);
        const grid = panelElements.panel.querySelector(".dashboard-grid");
        if (grid) {
          const card = renderPlotCard(dashboard, plot, grid);
          grid.appendChild(card);
        }
      });

      dashboardElements.set(dashboard.id, {
        ...panelElements,
        tabWrapper: tabElements.wrapper,
        tabButton: tabElements.button,
        tabLabel: tabElements.label,
        tabInput: tabElements.tabInput,
      });

      tabElements.renameButton.addEventListener("click", (event) => {
        event.stopPropagation();
        activateDashboard(dashboard.id);
        requestAnimationFrame(() => {
          startTabRename(dashboard);
        });
      });

      tabElements.tabInput.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finishTabRename(dashboard, { commit: true });
        }
        if (event.key === "Escape") {
          event.preventDefault();
          finishTabRename(dashboard, { commit: false });
        }
      });

      tabElements.tabInput.addEventListener("blur", () => {
        finishTabRename(dashboard, { commit: true });
      });

      tabElements.deleteButton.addEventListener("click", (event) => {
        event.stopPropagation();
        if (
          !window.confirm(
            `Delete "${dashboard.name}"? This cannot be undone.`,
          )
        ) {
          return;
        }
        const wasActive = activeDashboardId === dashboard.id;
        dashboards = dashboards.filter((entry) => entry.id !== dashboard.id);
        if (wasActive) {
          activeDashboardId = dashboards[0]?.id ?? null;
        }
        persist();
        clearDatasetSliceCache();
        onDashboardDelete?.(dashboard);
        renderDashboards();
        if (wasActive) {
          if (activeDashboardId) {
            activateDashboard(activeDashboardId);
          } else {
            const datasetButton = tabList.querySelector(
              '.tab-button[data-tab="dataset"]',
            );
            datasetButton?.click();
          }
        }
      });
    });

    dashboards.forEach((dashboard) => {
      updateDashboardWarning(dashboard);
    });
    updatePlotAvailability();
  }

  function setActiveDashboard(id) {
    activeDashboardId = id;
    persist();

    const panels = panelContainer.querySelectorAll(".dashboard-panel");
    panels.forEach((panel) => {
      panel.hidden = panel.dataset.dashboardId !== id;
    });
  }

  function hideAllDashboards() {
    panelContainer.querySelectorAll(".dashboard-panel").forEach((panel) => {
      panel.hidden = true;
    });
  }

  function refreshPlots() {
    plotElements.forEach((entry) => {
      entry.renderPlot();
    });
  }

  function updateDatalists() {
    return;
  }

  function addDashboard() {
    if (!canCreateDashboard()) {
      return null;
    }
    const index = dashboards.length + 1;
    const dashboard = createDashboard(`Dashboard ${index}`);
    dashboards.push(dashboard);
    persist();
    renderDashboards();
    return dashboard.id;
  }

  function setCurrentFileContext({ fileKey, fileLabel }) {
    const previousFileKey = currentFileKey;
    currentFileKey = fileKey || null;
    currentFileLabel = fileLabel || "";
    if (previousFileKey !== currentFileKey) {
      clearDatasetSliceCache();
    }
    updateAddButtonState();
    dashboards.forEach((dashboard) => {
      dashboard.plots.forEach((plot) => {
        ensurePlotFileBinding(dashboard, plot);
      });
      updateDashboardWarning(dashboard);
    });
    updatePlotAvailability();
    refreshPlots();
  }

  const { dashboards: storedDashboards, activeDashboardId: storedActive } =
    loadDashboardState();
  dashboards = storedDashboards.map((dashboard) => {
    normalizeDashboardLayout(dashboard);
    return dashboard;
  });
  activeDashboardId = storedActive;
  renderDashboards();
  ensureActiveDashboard();
  updateAddButtonState();

  if (addButton) {
    addButton.addEventListener("click", () => {
      const newId = addDashboard();
      if (!newId) {
        return;
      }
      setActiveDashboard(newId);
    });
  }

  return {
    setActiveDashboard,
    hideAllDashboards,
    refreshPlots,
    updateDatalists,
    ensureActiveDashboard,
    getActiveDashboardId: () => activeDashboardId,
    hasDashboards: () => dashboards.length > 0,
    addDashboard,
    setCurrentFileContext,
    getDashboards: () => dashboards.map((dashboard) => ({ ...dashboard })),
    getCurrentFileKey: () => currentFileKey,
    addPlotToDashboard: (dashboardId, plotConfig) => {
      const dashboard = dashboards.find((entry) => entry.id === dashboardId);
      if (!dashboard) {
        return null;
      }
      const plot = {
        ...createPlotConfig(),
        ...plotConfig,
        id: createId(),
        fileKey: plotConfig?.fileKey ?? currentFileKey ?? null,
        fileLabel: (plotConfig?.fileLabel ?? currentFileLabel) || null,
      };
      dashboard.plots.push(plot);
      persist();

      const panel = panelContainer.querySelector(
        `.dashboard-panel[data-dashboard-id="${dashboardId}"]`,
      );
      const grid = panel?.querySelector(".dashboard-grid");
      if (grid) {
        const card = renderPlotCard(dashboard, plot, grid);
        grid.appendChild(card);
      }
      updateDashboardWarning(dashboard);
      updatePlotAvailability();
      return plot.id;
    },
    updatePlotConfig: (dashboardId, plotId, config) => {
      const dashboard = dashboards.find((entry) => entry.id === dashboardId);
      if (!dashboard) {
        return;
      }
      const plot = dashboard.plots.find((entry) => entry.id === plotId);
      if (!plot) {
        return;
      }
      Object.assign(plot, config);
      persist();
      const entry = plotElements.get(plotId);
      entry?.updateTitle?.();
      entry?.renderPlot?.();
    },
    addDashboardFromSchema(schema, { fileKey: fk, fileLabel: fl } = {}) {
      const resolvedKey = fk ?? currentFileKey;
      const resolvedLabel = fl ?? currentFileLabel;
      if (!resolvedKey) return [];

      const createdIds = [];
      for (const dashDef of schema.dashboards ?? []) {
        const dashboard = {
          ...createDashboard(dashDef.name),
          fileKey: resolvedKey,
          fileLabel: resolvedLabel,
          layout: { ...DEFAULT_DASHBOARD_LAYOUT, ...(dashDef.layout ?? {}) },
        };
        dashboards.push(dashboard);

        for (const plotDef of dashDef.plots ?? []) {
          const plot = {
            ...createPlotConfig(),
            xPath: plotDef.xPath ?? "",
            yPath: plotDef.yPath ?? "",
            additionalYPaths: plotDef.additionalYPaths ?? [],
            yMode: plotDef.yMode ?? "1d",
            sliceAxis: plotDef.sliceAxis ?? 0,
            fileKey: resolvedKey,
            fileLabel: resolvedLabel,
            plotSettings: plotDef.title
              ? { ...createDefaultPlotSettings(), title: plotDef.title }
              : null,
          };
          plot.id = createId();
          dashboard.plots.push(plot);
        }
        createdIds.push(dashboard.id);
      }

      persist();
      renderDashboards();
      return createdIds;
    },
  };
}

function findAxisDatasetByName(datasets, parentPath, targetName, length) {
  return datasets.find((dataset) => {
    if (dataset.parentPath !== parentPath || !isNumeric1D(dataset)) {
      return false;
    }
    if (length !== undefined && (dataset.shape?.[0] ?? 0) !== length) {
      return false;
    }
    return normalizeAxisName(dataset.name) === targetName;
  });
}
