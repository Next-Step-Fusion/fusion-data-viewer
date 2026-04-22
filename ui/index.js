import { isNumericDtype, openFile } from "../data/index.js";
import { detectSchema } from "../data/autoSchema.js";
import {
  createDefaultPlotSettings,
  disposePlot,
  loadPlotly,
  resizePlot,
  renderHeatmapPlot,
  renderXYPlot,
  renderXYPlotSeries,
} from "../viz/index.js";
import { createMainLayout } from "./layout.js";
import { createTreeView } from "./tree/index.js";
import { createDataView } from "./dataview/index.js";
import { createDashboardView } from "./dashboard/index.js";
import { icons } from "./icons.js";
import {
  hasFileInOpfs,
  isOpfsSupported,
  listOpfsFiles,
  listOpfsFileKeys,
  loadFileFromOpfs,
  removeFileFromOpfs,
  saveFileToOpfs,
} from "../storage/opfs.js";
import { registerFileWithServiceWorker } from "./serviceWorker.js";

const TREE_ROOT_LABEL = "Opened file(s)";

function createAsyncSession(session) {
  if (!session) {
    return null;
  }
  return {
    name: session.name,
    accessMode: session.accessMode,
    loadStrategy: session.loadStrategy,
    metadataOnly: session.metadataOnly,
    listChildren: async (path) => session.listChildren(path),
    getNodeInfo: async (path) => session.getNodeInfo(path),
    listDatasetsMetadata: async () => session.listDatasetsMetadata(),
    listDatasets: async () => session.listDatasets(),
    readDataset1D: async (path, options) => session.readDataset1D(path, options),
    readDataset2DRow: async (path, options) =>
      session.readDataset2DRow(path, options),
    readDataset2DColumn: async (path, options) =>
      session.readDataset2DColumn(path, options),
    readDatasetND2D: async (path, options) =>
      session.readDatasetND2D(path, options),
    readDataset3DFrame: async (path, options) =>
      session.readDataset3DFrame(path, options),
    getDatasetPreview: async (path, options) =>
      session.getDatasetPreview(path, options),
    getDatasetPreviewAsync: async (path, options) =>
      session.getDatasetPreviewAsync(path, options),
    close: () => session.close(),
  };
}


export function initApp() {
  const layout = createMainLayout();
  if (!layout) {
    return;
  }

  const sessions = new Map();
  const openSessions = new Map();
  const maxSessions = 2;
  let currentFileKey = null;
  let selectionToken = 0;
  let plotToken = 0;
  let datasetIndex = [];
  let dashboardView = null;
  const fileAccessMode = "lazy";

  const opfsNamePattern = /^[A-Za-z0-9_-]+\\.h5$/;
  const shouldLogOpfsCopies = !import.meta.env?.PROD;
  const recentOpfsStorageKey = "fdv:recent-opfs-files";
  const recentOpfsLimit = 2;

  if (shouldLogOpfsCopies && isOpfsSupported()) {
    void listOpfsFiles()
      .then((entries) => {
        const formatted = entries.length
          ? entries
              .map(({ name, size }) =>
                Number.isFinite(size) ? `${name} (${size} bytes)` : name,
              )
              .join(", ")
          : "none";
      })
      .catch(() => {
      });
  }

  function canUseLocalStorage() {
    try {
      return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
    } catch (error) {
      return false;
    }
  }

  function loadRecentOpfsEntries() {
    if (!canUseLocalStorage()) {
      return [];
    }
    try {
      const stored = window.localStorage.getItem(recentOpfsStorageKey);
      if (!stored) {
        return [];
      }
      const parsed = JSON.parse(stored);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed
        .filter((entry) => entry?.fileKey)
        .map((entry) => ({
          fileKey: entry.fileKey,
          fileLabel: entry.fileLabel ?? entry.displayName ?? null,
        }));
    } catch (error) {
      return [];
    }
  }

  function persistRecentOpfsEntries(entries) {
    if (!canUseLocalStorage()) {
      return;
    }
    const trimmed = entries.slice(0, recentOpfsLimit);
    window.localStorage.setItem(recentOpfsStorageKey, JSON.stringify(trimmed));
  }

  function recordRecentOpfsEntry(fileKey, fileLabel) {
    if (!fileKey) {
      return;
    }
    const entries = loadRecentOpfsEntries().filter(
      (entry) => entry.fileKey !== fileKey,
    );
    entries.unshift({
      fileKey,
      fileLabel: fileLabel ?? null,
    });
    persistRecentOpfsEntries(entries);
  }

  function removeRecentOpfsEntry(fileKey) {
    if (!fileKey) {
      return;
    }
    const entries = loadRecentOpfsEntries().filter(
      (entry) => entry.fileKey !== fileKey,
    );
    persistRecentOpfsEntries(entries);
  }

  const dataView = createDataView({
    viewButtons: layout.viewButtons,
    rawPanel: layout.rawPanel,
    plotPanel: layout.plotPanel,
    infoPanel: layout.infoPanel,
    errorPanel: layout.errorPanel,
    dataMeta: layout.dataMeta,
    sliceControls: layout.sliceControls,
    plotControlsSlot: layout.plotControlsSlot,
    plotSettings: createDefaultPlotSettings(),
    onPlotRequest: handlePlotRequest,
    onPlotTabOpen: async () => {
      try {
        await loadPlotly();
        const plotContainer = dataView?.plotContainer;
        if (plotContainer) {
          requestAnimationFrame(() => {
            requestAnimationFrame(() => {
              void resizePlot(plotContainer);
            });
          });
        }
      } catch (error) {
        dataView.showPlotError(error.message);
      }
    },
    getDashboards: () => (dashboardView ? dashboardView.getDashboards() : []),
    getCurrentFileKey: () =>
      dashboardView ? dashboardView.getCurrentFileKey() : null,
    getPlotFiles: () =>
      [...sessions.entries()].map(([fileKey, entry]) => ({
        fileKey,
        fileLabel: resolveDisplayLabel(fileKey, {
          fileLabel: entry.fileLabel,
          sessionName: entry.session?.name,
        }),
      })),
    getPlotDatasets: (fileKey) => getDatasetIndexForFile(fileKey),
    addPlotToDashboard: (dashboardId, plotConfig) =>
      dashboardView?.addPlotToDashboard(dashboardId, plotConfig),
    createDashboard: () => dashboardView?.addDashboard(),
    activateDashboard: (dashboardId) => {
      if (dashboardId) {
        setPrimaryTab(dashboardId);
      }
    },
    onPlotConfigChange: (target, config) => {
      if (!target) {
        return;
      }
      dashboardView?.updatePlotConfig(target.dashboardId, target.plotId, config);
    },
  });

  let treeView = null;
  treeView = createTreeView({
    rootElement: layout.treeRoot,
    statusElement: layout.treeStatus,
    filterInput: layout.treeFilter,
    onSelect: handleSelect,
    onOpen: handleOpen,
    onClose: (node) => {
      if (node?.fileKey) {
        void handleCloseFile(node.fileKey);
      }
    },
    loadChildren: async (node) => {
      const targetFileKey = node.fileKey ?? currentFileKey;
      if (!targetFileKey) {
        return [];
      }
      const entry = sessions.get(targetFileKey);
      const session = await ensureSessionForFileKey(targetFileKey, {
        fileLabel: entry?.fileLabel,
      });
      if (!session) {
        return [];
      }
      const children = await session.listChildren(node.path);
      return assignFileKey(children, targetFileKey);
    },
    loadLazyChildren: async (node) => {
      if (!node.fileKey) {
        return [];
      }
      const entry = sessions.get(node.fileKey);
      const session = await ensureSessionForFileKey(node.fileKey, {
        fileLabel: entry?.fileLabel,
      });
      if (!session) {
        treeView?.setStatus("Open the selected file to continue.");
        throw new Error("Unable to open the file session.");
      }
      const children = await session.listChildren(node.path);
      return assignFileKey(children, node.fileKey);
    },
    onError: (message) => showAppError(message),
  });

  dashboardView = createDashboardView({
    tabList: layout.tabList,
    addButton: layout.addDashboard,
    panelContainer: layout.dashboardPanels,
    getDatasetIndex: (fileKey) => getDatasetIndexForFile(fileKey),
    getDatasetByPath: getDatasetByPathForFile,
    getSession: (fileKey, fileLabel) =>
      ensureSessionForFileKey(fileKey, { fileLabel }),
    hasSession: (fileKey) => sessions.has(fileKey),
    loadPlotly,
    onCustomizePlot: (dashboard, plot) => {
      if (!plot) {
        return;
      }
      setPrimaryTab("dataset");
      dataView.applyPlotConfig(plot);
      dataView.setPlotSyncTarget({ dashboardId: dashboard.id, plotId: plot.id });
      dataView.setActiveTab("plot");
    },
    onDashboardDelete: (dashboard) => {
      if (!dashboard) {
        return;
      }
      const plotKeys = new Set();
      dashboard.plots?.forEach((plot) => {
        if (plot.fileKey) {
          plotKeys.add(plot.fileKey);
        }
      });
      if (dashboard.fileKey) {
        plotKeys.add(dashboard.fileKey);
      }
      plotKeys.forEach((fileKey) => {
        maybeCloseSession(fileKey);
      });
    },
  });

  function setPrimaryTab(tabId) {
    const buttons = layout.tabList.querySelectorAll(".tab-button");
    buttons.forEach((button) => {
      const isActive = button.dataset.tab === tabId;
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });

    if (tabId === "dataset") {
      layout.datasetPanel.hidden = false;
      layout.dataView.classList.remove("dashboard-active");
      dashboardView.hideAllDashboards();
    } else {
      layout.datasetPanel.hidden = true;
      layout.dataView.classList.add("dashboard-active");
      dashboardView.setActiveDashboard(tabId);
    }
  }

  layout.tabList.addEventListener("click", (event) => {
    const button = event.target.closest(".tab-button[data-tab]");
    if (!button) {
      return;
    }
    setPrimaryTab(button.dataset.tab);
  });

  if (layout.addDashboard) {
    layout.addDashboard.addEventListener("click", () => {
      const nextId = dashboardView.getActiveDashboardId();
      if (nextId) {
        setPrimaryTab(nextId);
      }
    });
  }

  const initialDashboardId = dashboardView.ensureActiveDashboard();
  setPrimaryTab(initialDashboardId ?? "dataset");

  function setTreeCollapsed(isCollapsed) {
    layout.mainLayout.classList.toggle("tree-collapsed", isCollapsed);
    layout.treeToggle.setAttribute("aria-expanded", String(!isCollapsed));
    layout.treeToggle.innerHTML = isCollapsed ? icons.chevronRight : icons.chevronLeft;
    layout.treeToggle.setAttribute(
      "aria-label",
      isCollapsed ? "Show tree view" : "Hide tree view",
    );
  }

  window.addEventListener("beforeunload", (event) => {
    if (!sessions.size) {
      return;
    }
    event.preventDefault();
    event.returnValue = "";
  });

  const datasetTabButton = layout.tabList.querySelector('[data-tab="dataset"]');

  function updateFileUI() {
    const hasFiles = sessions.size > 0;
    layout.treeToggle.hidden = !hasFiles;
    datasetTabButton.hidden = !hasFiles;
    layout.viewerTabs.hidden = !hasFiles;
  }

  updateFileUI();

  let isTreeCollapsed = false;
  setTreeCollapsed(isTreeCollapsed);

  layout.treeToggle.addEventListener("click", () => {
    isTreeCollapsed = !isTreeCollapsed;
    setTreeCollapsed(isTreeCollapsed);
  });


  function resetSelectionState() {
    selectionToken += 1;
    dataView.clearView();
  }

  function resetAppState() {
    treeView.reset();
    treeView.setStatus("");
    dataView.clearView();
    dataView.setTabsEnabled(false);
    dataView.setPlotDatasets([]);
    dataView.resetPlotSettings(createDefaultPlotSettings());
    dataView.setAddToDashboardEnabled(false);
    datasetIndex = [];
    currentFileKey = null;
    dataView.refreshPlotFileOptions();
    dashboardView.updateDatalists();
    dashboardView.setCurrentFileContext({ fileKey: null, fileLabel: "" });
    renderFileSelector();
  }

  let currentFileLabel = "";

  function setFileDisplay(name) {
    currentFileLabel = name ?? "";
    renderFileSelector();
  }

  function showAppError(message) {
    dataView.showError(message);
  }

  async function resolveLocalFileRegistration(
    fileOrHandle,
    { displayName } = {},
  ) {
    let file = null;
    if (fileOrHandle instanceof File) {
      file = fileOrHandle;
    } else if (fileOrHandle?.getFile) {
      try {
        file = await fileOrHandle.getFile();
      } catch (error) {
        console.warn(
          "Unable to resolve file for service worker registration.",
          error,
        );
      }
    }
    if (!file) {
      return null;
    }
    const swRegistration = await registerFileWithServiceWorker(file, {
      displayName,
    });
    if (!swRegistration?.url) {
      return null;
    }
    return { fileUrl: swRegistration.url };
  }

  async function openHdf5Session(fileOrHandle, options = {}) {
    const session = await openFile(fileOrHandle, options);
    return createAsyncSession(session);
  }

  function getSessionForFileKey(fileKey) {
    if (!fileKey) {
      return null;
    }
    const entry = sessions.get(fileKey);
    if (!entry) {
      return null;
    }
    entry.lastAccess = Date.now();
    return entry.session;
  }

  function trackOpenSession(fileKey, promise) {
    const entry = { promise, settled: false };
    openSessions.set(fileKey, entry);
    promise.finally(() => {
      entry.settled = true;
      if (openSessions.get(fileKey) === entry) {
        openSessions.delete(fileKey);
      }
    });
    return entry;
  }

  function isOpfsEncodedName(name) {
    return Boolean(name && opfsNamePattern.test(name));
  }

  async function invalidateCachedFile(fileKey) {
    if (!fileKey) {
      return;
    }
    await removeFileFromOpfs(fileKey);
    removeRecentOpfsEntry(fileKey);
  }

  function decodeFileKeyLabel(fileKey) {
    if (!fileKey) {
      return "";
    }
    const [segment] = fileKey.split("|");
    if (!segment) {
      return "";
    }
    try {
      const normalized = segment.replace(/-/g, "+").replace(/_/g, "/");
      const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
      const decoded = atob(padded);
      const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0));
      const text = new TextDecoder().decode(bytes);
      return text || segment;
    } catch (error) {
      return segment;
    }
  }

  function resolveDisplayLabel(fileKey, { fileLabel, sessionName } = {}) {
    const decodedLabel = decodeFileKeyLabel(fileKey);
    const sanitizedFileLabel =
      fileLabel && !isOpfsEncodedName(fileLabel) ? fileLabel : "";
    const fallbackSessionName =
      sessionName && !isOpfsEncodedName(sessionName) ? sessionName : "";
    const candidates = [
      sanitizedFileLabel,
      decodedLabel,
      fallbackSessionName,
      "Unnamed file",
    ];
    return candidates.find((label) => typeof label === "string" && label.trim()) ?? "Unnamed file";
  }

  async function ensureSessionForFileKey(fileKey, { fileLabel } = {}) {
    if (!fileKey) {
      return null;
    }
    const existing = getSessionForFileKey(fileKey);
    if (existing) {
      return existing;
    }
    const inflight = openSessions.get(fileKey);
    if (inflight && !inflight.settled) {
      return inflight.promise;
    }
    let openState;
    const openPromise = (async () => {
      try {
        const cachedFile = await loadFileFromOpfs(fileKey);
        if (!cachedFile) {
          return null;
        }
        const label = resolveDisplayLabel(fileKey, { fileLabel });
        const session = await openHdf5Session(cachedFile, {
          accessMode: fileAccessMode,
        });
        registerSession(fileKey, session, label, {
          openState,
          source: "opfs",
        });
        const entry = sessions.get(fileKey);
        if (entry) {
          entry.datasetIndex = await session.listDatasetsMetadata();
          entry.fileLabel = label;
        }
        return session;
      } catch (error) {
        if (error?.name === "FileTooLargeError") {
          treeView.setStatus(error.message);
          showAppError(error.message);
          return null;
        }
        if (error?.name === "NotReadableError") {
          await invalidateCachedFile(fileKey);
          showAppError("Re-open the file to continue.");
          return null;
        }
        console.warn("Unable to open cached file session.", error);
        return null;
      }
    })();
    openState = trackOpenSession(fileKey, openPromise);
    return openPromise;
  }

  function getCurrentSession() {
    return getSessionForFileKey(currentFileKey);
  }

  function getRetainedFileKeys({ includeCurrent = true } = {}) {
    const retainedKeys = new Set();
    if (includeCurrent && currentFileKey) {
      retainedKeys.add(currentFileKey);
    }
    dashboardView?.getDashboards().forEach((dashboard) => {
      dashboard.plots?.forEach((plot) => {
        if (plot.fileKey) {
          retainedKeys.add(plot.fileKey);
        }
      });
      if (dashboard.fileKey) {
        retainedKeys.add(dashboard.fileKey);
      }
    });
    return retainedKeys;
  }

  function closeSession(
    fileKey,
    { allowCurrent = false, forceRetained = false } = {},
  ) {
    if (!fileKey) {
      return false;
    }
    if (
      !forceRetained &&
      getRetainedFileKeys({ includeCurrent: !allowCurrent }).has(fileKey)
    ) {
      return false;
    }
    const entry = sessions.get(fileKey);
    if (!entry) {
      return false;
    }
    entry.session.close();
    sessions.delete(fileKey);
    dataView.refreshPlotFileOptions();
    renderFileSelector();
    updateFileUI();
    return true;
  }

  async function handleCloseFile(fileKey) {
    if (!fileKey) {
      return;
    }
    const fileLabel = resolveFileLabel(fileKey);
    const dashboardsUsingFile = dashboardView
      ?.getDashboards()
      .filter((dashboard) => {
        if (dashboard.fileKey === fileKey) {
          return true;
        }
        return dashboard.plots?.some((plot) => plot.fileKey === fileKey);
      })
      .map((dashboard) => dashboard.name?.trim() || "Untitled dashboard") ?? [];
    const uniqueDashboardNames = [...new Set(dashboardsUsingFile)];
    const dashboardWarning = uniqueDashboardNames.length
      ? `\n\nUsed by ${uniqueDashboardNames.length} dashboard${
          uniqueDashboardNames.length === 1 ? "" : "s"
        }: ${uniqueDashboardNames.join(", ")}.`
      : "";
    const confirmed = window.confirm(
      `Close "${fileLabel}"? This will remove its cached copy from OPFS storage.${dashboardWarning}`,
    );
    if (!confirmed) {
      return;
    }
    const wasCurrent = fileKey === currentFileKey;
    const closed = closeSession(fileKey, {
      allowCurrent: true,
      forceRetained: true,
    });
    if (!closed) {
      return;
    }
    await invalidateCachedFile(fileKey);
    if (!wasCurrent) {
      return;
    }
    const remainingEntries = getTreeFileEntries();
    if (remainingEntries.length) {
      currentFileKey = null;
      await switchToFile(remainingEntries[0].fileKey);
      return;
    }
    currentFileKey = null;
    currentFileLabel = "";
    treeView.reset();
    treeView.setRoot([]);
    dataView.clearView();
    dataView.setTabsEnabled(false);
    dataView.setPlotDatasets([]);
    dataView.setAddToDashboardEnabled(false);
    dashboardView.setCurrentFileContext({ fileKey: null, fileLabel: "" });
    setFileDisplay("");
  }

  function resolveFileLabel(fileKey) {
    if (!fileKey) {
      return "unknown source";
    }
    if (fileKey === currentFileKey && currentFileLabel) {
      return currentFileLabel;
    }
    return sessions.get(fileKey)?.fileLabel ?? fileKey;
  }

  function resolveFileSourceLabel(fileKey) {
    if (!fileKey) {
      return "unknown source";
    }
    const source = sessions.get(fileKey)?.source;
    if (source === "opfs") {
      return "OPFS storage";
    }
    if (source === "disk") {
      return "disk drive";
    }
    return "unknown source";
  }

  function evictSessionsIfNeeded() {
    if (sessions.size <= maxSessions) {
      return;
    }
    const retainedKeys = getRetainedFileKeys();
    const candidates = [...sessions.entries()]
      .filter(([fileKey]) => !retainedKeys.has(fileKey))
      .sort(([, left], [, right]) => left.lastAccess - right.lastAccess);
    while (sessions.size > maxSessions && candidates.length) {
      const [fileKey] = candidates.shift();
      closeSession(fileKey);
    }
  }

  function registerSession(
    fileKey,
    session,
    fileLabel,
    { openState, source } = {},
  ) {
    if (!fileKey || !session) {
      return;
    }
    const inflight = openSessions.get(fileKey);
    if (inflight && inflight !== openState && !inflight.settled) {
      return;
    }
    const existing = sessions.get(fileKey);
    if (existing?.session === session) {
      existing.lastAccess = Date.now();
      existing.fileLabel = fileLabel ?? existing.fileLabel;
      if (source) {
        existing.source = source;
      }
      return;
    }
    if (existing) {
      existing.session.close();
    }
    sessions.set(fileKey, {
      session,
      lastAccess: Date.now(),
      fileLabel,
      datasetIndex: [],
      source: source ?? null,
    });
    evictSessionsIfNeeded();
    dataView.refreshPlotFileOptions();
    renderFileSelector();
    updateFileUI();
  }

  function maybeCloseSession(fileKey) {
    if (!fileKey) {
      return;
    }
    if (!getRetainedFileKeys().has(fileKey)) {
      closeSession(fileKey);
    }
  }

  async function resolveFileKey(fileOrHandle, displayName, pathHint) {
    const name = displayName ?? fileOrHandle?.name ?? "";
    let size = null;
    let lastModified = null;

    if (fileOrHandle instanceof File) {
      size = fileOrHandle.size;
      lastModified = fileOrHandle.lastModified;
    } else if (fileOrHandle?.getFile) {
      try {
        const file = await fileOrHandle.getFile();
        size = file.size;
        lastModified = file.lastModified;
      } catch (error) {
        console.warn("Unable to resolve file metadata for dashboard.", error);
      }
    }

    return [name, size ?? "", lastModified ?? "", pathHint ?? ""].join("|");
  }

  async function openFileFromOpfs(fileKey) {
    const cachedFile = await loadFileFromOpfs(fileKey);
    if (!cachedFile) {
      throw new Error("Unable to load file from storage.");
    }

    try {
      return await openHdf5Session(cachedFile, { accessMode: fileAccessMode });
    } catch (error) {
      if (error?.name === "FileTooLargeError") {
        treeView.setStatus(error.message);
        showAppError(error.message);
        throw error;
      }
      if (error?.name === "NotReadableError") {
        const reopenError = new Error("Re-open the file to continue.");
        reopenError.name = "NotReadableError";
        throw reopenError;
      }
      throw error;
    }
  }

  async function cacheFileInOpfs(fileOrHandle, fileKey, displayName) {
    if (!fileKey) {
      return false;
    }
    if (await hasFileInOpfs(fileKey, { displayName })) {
      return true;
    }
    let file = null;
    if (fileOrHandle instanceof File) {
      file = fileOrHandle;
    } else if (fileOrHandle?.getFile) {
      try {
        file = await fileOrHandle.getFile();
      } catch (error) {
        console.warn("Unable to resolve file for OPFS cache.", error);
        return false;
      }
    }

    if (!file) {
      return false;
    }
    const cached = await saveFileToOpfs(fileKey, file, { displayName });
    if (cached) {
      recordRecentOpfsEntry(fileKey, displayName ?? file.name);
    }
    return cached;
  }

  function trimLabel(label, maxLength = 40) {
    if (!label || label.length <= maxLength) {
      return label;
    }

    return `${label.slice(0, maxLength - 1)}…`;
  }

  function getTreeFileEntries() {
    const entries = [...sessions.entries()].map(([fileKey, entry]) => ({
      fileKey,
      fileLabel: resolveDisplayLabel(fileKey, {
        fileLabel: entry.fileLabel,
        sessionName: entry.session?.name,
      }),
    }));
    if (!entries.length) {
      return [];
    }
    return entries.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel));
  }

  function assignFileKey(nodes, fileKey) {
    return nodes.map((node) => ({
      ...node,
      fileKey,
      children: Array.isArray(node.children)
        ? assignFileKey(node.children, fileKey)
        : node.children,
    }));
  }

  function buildTreeRoot({ fileKey, fileLabel, children }) {
    const entries = getTreeFileEntries();
    return {
      name: TREE_ROOT_LABEL,
      path: "",
      type: "group",
      expanded: true,
      children: entries.map((entry) => {
        const isCurrent = entry.fileKey === fileKey;
        return {
          name: entry.fileLabel,
          path: "/",
          type: "group",
          fileKey: entry.fileKey,
          fileLabel: entry.fileLabel,
          isFileRoot: true,
          children: isCurrent ? assignFileKey(children, entry.fileKey) : null,
          lazyChildren: !isCurrent,
          expanded: isCurrent,
        };
      }),
    };
  }

  function renderFileSelector() {
    const switcher = layout.fileSwitcher;
    const switcherButtons = layout.fileSwitcherButtons;
    if (!switcher || !switcherButtons) {
      return;
    }

    const entries = [...sessions.entries()].map(([fileKey, entry]) => ({
      fileKey,
      fileLabel: resolveDisplayLabel(fileKey, {
        fileLabel: entry.fileLabel,
        sessionName: entry.session?.name,
      }),
    }));
    switcherButtons.innerHTML = "";

    if (entries.length <= 1) {
      switcher.hidden = true;
      return;
    }

    const hasCurrent = Boolean(currentFileKey && sessions.has(currentFileKey));
    const orderedEntries = hasCurrent
      ? entries
          .filter(({ fileKey }) => fileKey !== currentFileKey)
          .sort((a, b) => a.fileLabel.localeCompare(b.fileLabel))
      : entries.sort((a, b) => a.fileLabel.localeCompare(b.fileLabel));

    orderedEntries.forEach(({ fileKey, fileLabel }) => {
      const item = document.createElement("div");
      item.className = "tree-item";
      item.setAttribute("aria-selected", "false");

      const row = document.createElement("div");
      row.className = "tree-row";

      if (fileKey === currentFileKey) {
        const toggle = document.createElement("button");
        toggle.className = "tree-toggle";
        toggle.type = "button";
        toggle.setAttribute("aria-expanded", "true");
        toggle.textContent = "▾";
        row.appendChild(toggle);
      } else {
        const spacer = document.createElement("span");
        spacer.className = "tree-toggle spacer";
        row.appendChild(spacer);
      }

      const label = document.createElement("button");
      label.type = "button";
      label.className = "tree-label group";
      label.textContent = trimLabel(fileLabel);
      label.addEventListener("click", () => {
        void switchToFile(fileKey);
      });
      row.appendChild(label);

      const closeButton = document.createElement("button");
      closeButton.type = "button";
      closeButton.className = "file-switcher-close";
      closeButton.setAttribute("aria-label", "Close file");
      closeButton.innerHTML = icons.x;
      closeButton.addEventListener("click", (event) => {
        event.stopPropagation();
        void handleCloseFile(fileKey);
      });
      row.appendChild(closeButton);

      item.appendChild(row);
      switcherButtons.appendChild(item);
    });

    switcher.hidden = orderedEntries.length === 0;
  }

  async function switchToFile(fileKey) {
    if (!fileKey || fileKey === currentFileKey) {
      return;
    }

    const entry = sessions.get(fileKey);
    const fileLabel = resolveDisplayLabel(fileKey, {
      fileLabel: entry?.fileLabel,
      sessionName: entry?.session?.name,
    });
    selectionToken += 1;
    plotToken += 1;
    showAppError("");
    dataView.setTabsEnabled(false);
    dataView.setPlotDatasets([]);
    treeView.reset();
    treeView.setStatus("Loading file structure…");
    setFileDisplay(fileLabel);
    await disposePlot(dataView.plotContainer);

    const session = await ensureSessionForFileKey(fileKey, { fileLabel });
    if (!session) {
      treeView.setStatus("");
      showAppError("Open the selected file to continue.");
      renderFileSelector();
      return;
    }

    currentFileKey = fileKey;
    treeView.reset();

    const children = await session.listChildren("/");
    treeView.setStatus("");

    const rootNode = buildTreeRoot({
      fileKey,
      fileLabel,
      children,
    });
    treeView.renderNodes([rootNode]);

    datasetIndex = await session.listDatasetsMetadata();
    const currentSessionEntry = sessions.get(fileKey);
    if (currentSessionEntry) {
      currentSessionEntry.datasetIndex = datasetIndex;
      currentSessionEntry.fileLabel = fileLabel;
    }
    dataView.setPlotDatasets(datasetIndex, { fileKey, fileLabel });
    dataView.resetPlotSettings(createDefaultPlotSettings());
    dataView.setAddToDashboardEnabled(true);
    dashboardView.setCurrentFileContext({ fileKey, fileLabel });
    dashboardView.updateDatalists();
    resetSelectionState();
    renderFileSelector();
  }

  async function restoreFileTreeForFileKey(fileKey, fileLabel) {
    if (!fileKey) {
      return false;
    }

    const entry = sessions.get(fileKey);
    const resolvedLabel = resolveDisplayLabel(fileKey, {
      fileLabel: fileLabel ?? entry?.fileLabel,
      sessionName: entry?.session?.name,
    });
    selectionToken += 1;
    plotToken += 1;
    showAppError("");
    dataView.setTabsEnabled(false);
    dataView.setPlotDatasets([]);
    treeView.reset();
    treeView.setStatus("Loading file structure…");
    setFileDisplay(resolvedLabel);
    await disposePlot(dataView.plotContainer);

    const session = await ensureSessionForFileKey(fileKey, {
      fileLabel: resolvedLabel,
    });
    if (!session) {
      treeView.setStatus("");
      renderFileSelector();
      return false;
    }

    currentFileKey = fileKey;
    treeView.reset();

    const children = await session.listChildren("/");
    treeView.setStatus("");

    const rootNode = buildTreeRoot({
      fileKey,
      fileLabel: resolvedLabel,
      children,
    });
    treeView.renderNodes([rootNode]);

    datasetIndex = await session.listDatasetsMetadata();
    const currentSessionEntry = sessions.get(fileKey);
    if (currentSessionEntry) {
      currentSessionEntry.datasetIndex = datasetIndex;
      currentSessionEntry.fileLabel = resolvedLabel;
    }
    dataView.setPlotDatasets(datasetIndex, {
      fileKey,
      fileLabel: resolvedLabel,
    });
    dataView.resetPlotSettings(createDefaultPlotSettings());
    dataView.setAddToDashboardEnabled(true);
    dashboardView.setCurrentFileContext({ fileKey, fileLabel: resolvedLabel });
    dashboardView.updateDatalists();
    resetSelectionState();
    renderFileSelector();
    return true;
  }

  async function openFileSession(fileOrHandle, options = {}) {
    const {
      displayName,
      handle,
      pathHint,
      fileKey: providedFileKey,
      fileUrl: providedFileUrl,
    } = options;
    const fileLabel = displayName ?? fileOrHandle?.name ?? "Unnamed file";
    const fileKey =
      providedFileKey ?? (await resolveFileKey(fileOrHandle, fileLabel, pathHint));
    const inflight = openSessions.get(fileKey);
    if (inflight && !inflight.settled) {
      try {
        await inflight.promise;
      } catch (error) {
        console.warn("Unable to await in-flight session open.", error);
      }
    }
    selectionToken += 1;
    plotToken += 1;
    showAppError("");
    dataView.setTabsEnabled(false);
    dataView.setPlotDatasets([]);
    treeView.setStatus("Loading file structure…");
    setFileDisplay(fileLabel);
    await disposePlot(dataView.plotContainer);
    let session = getSessionForFileKey(fileKey);
    if (!session) {
      const localFileUrl =
        providedFileUrl ??
        (await resolveLocalFileRegistration(handle ?? fileOrHandle, {
          displayName: fileLabel,
          pathHint,
        }))?.fileUrl ??
        null;
      if (localFileUrl) {
        const openPromise = openHdf5Session(handle ?? fileOrHandle, {
          accessMode: fileAccessMode,
          fileUrl: localFileUrl,
        });
        const openState = trackOpenSession(fileKey, openPromise);
        session = await openPromise;
        registerSession(fileKey, session, fileLabel, {
          openState,
          source: "disk",
        });
        void cacheFileInOpfs(handle ?? fileOrHandle, fileKey, fileLabel);
      } else {
        const cached = await cacheFileInOpfs(handle ?? fileOrHandle, fileKey, fileLabel);
        if (!cached) {
          treeView.setStatus("");
          showAppError(
            "Unable to save the file to browser storage. Please try again.",
          );
          return;
        }
        const openPromise = openFileFromOpfs(fileKey);
        const openState = trackOpenSession(fileKey, openPromise);
        session = await openPromise;
        registerSession(fileKey, session, fileLabel, {
          openState,
          source: "opfs",
        });
      }
    }
    const previousFileKey = currentFileKey;
    currentFileKey = fileKey;
    treeView.reset();

    const children = await session.listChildren("/");
    treeView.setStatus("");

    const rootNode = buildTreeRoot({
      fileKey,
      fileLabel,
      children,
    });
    treeView.renderNodes([rootNode]);

    datasetIndex = await session.listDatasetsMetadata();
    const currentSessionEntry = sessions.get(fileKey);
    if (currentSessionEntry) {
      currentSessionEntry.datasetIndex = datasetIndex;
      currentSessionEntry.fileLabel = fileLabel;
    }
    dataView.setPlotDatasets(datasetIndex, { fileKey, fileLabel });
    dataView.resetPlotSettings(createDefaultPlotSettings());
    dataView.setAddToDashboardEnabled(true);
    dashboardView.setCurrentFileContext({ fileKey, fileLabel });
    dashboardView.updateDatalists();
    const hasExistingDashboards = dashboardView.getDashboards().some((d) => d.fileKey === fileKey);
    if (!hasExistingDashboards) {
      const schema = await detectSchema(session, datasetIndex);
      if (schema) {
        const ids = dashboardView.addDashboardFromSchema(schema, { fileKey, fileLabel });
        if (ids.length > 0) {
          setPrimaryTab(ids[0]);
        }
      }
    }
    resetSelectionState();
    renderFileSelector();
  }

  function getDatasetByPath(path) {
    return datasetIndex.find((dataset) => dataset.path === path);
  }

  async function getDatasetIndexForFile(fileKey, { fileLabel } = {}) {
    if (!fileKey) {
      return [];
    }
    const entry = sessions.get(fileKey);
    if (!entry) {
      const session = await ensureSessionForFileKey(fileKey, { fileLabel });
      if (!session) {
        return [];
      }
    }
    const nextEntry = sessions.get(fileKey);
    if (!nextEntry) {
      return [];
    }
    if (!nextEntry.datasetIndex?.length) {
      nextEntry.datasetIndex = await nextEntry.session.listDatasetsMetadata();
    }
    return nextEntry.datasetIndex;
  }

  async function getDatasetByPathForFile(fileKey, path) {
    const datasets = await getDatasetIndexForFile(fileKey);
    return datasets.find((dataset) => dataset.path === path) ?? null;
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

  async function resetPlot(message) {
    await disposePlot(dataView.plotContainer);
    dataView.clearPlotArea();
    if (message) {
      dataView.setPlotPlaceholder(message);
    }
  }

  async function handlePlotRequest({
    fileKey,
    xPath,
    yPath,
    yAxisPath,
    slicePath,
    colorbarPath,
    yMode,
    sliceIndex,
    sliceAxis,
    showAllSeries = false,
    plotSettings,
    plotOverrides,
    showLoading = true,
  }) {
    plotToken += 1;
    const token = plotToken;
    dataView.showPlotError("");
    dataView.showPlotNote("");

    const resolvedFileKey = fileKey ?? currentFileKey;
    const session = await ensureSessionForFileKey(resolvedFileKey);
    if (!session) {
      dataView.showPlotError("Open the selected HDF5 file to render a plot.");
      await resetPlot("Open an HDF5 file to choose datasets.");
      return;
    }

    if (!yPath) {
      await resetPlot("");
      return;
    }

    const plotDatasets = await getDatasetIndexForFile(resolvedFileKey);
    const yDataset = plotDatasets.find((dataset) => dataset.path === yPath);
    if (!yDataset) {
      dataView.showPlotError("Selected Y dataset was not found.");
      await resetPlot("");
      return;
    }
    const sliceDataset = slicePath
      ? plotDatasets.find((dataset) => dataset.path === slicePath)
      : null;
    const colorbarDataset = colorbarPath
      ? plotDatasets.find((dataset) => dataset.path === colorbarPath)
      : null;

    const plotMode =
      yMode ??
      ((yDataset.shape?.length ?? 0) >= 3
        ? "heatmap"
        : yDataset.shape?.length === 2
          ? "2d"
          : "1d");
    const basePlotSettings = {
      ...createDefaultPlotSettings(),
      ...(plotSettings ?? {}),
    };
    const plotTitle = basePlotSettings?.title?.trim() || "Plot";
    const plotSource = resolveFileLabel(resolvedFileKey);
    const plotSourceLocation = resolveFileSourceLabel(resolvedFileKey);
    let heatmapPlotSettings = basePlotSettings;

    try {
      let yValues = [];
      let yLength = 0;
      let xValues = null;
      let xDataset = null;
      let xLength = null;
      let resolvedSliceAxis = Number.isInteger(sliceAxis) ? sliceAxis : 0;
      let defaultAxisRange = null;
      let defaultAxisStep = 1;
      const maxPoints = resolvePositiveInteger(basePlotSettings.maxPoints, 100000);
      const maxRows = resolvePositiveInteger(basePlotSettings.maxRows, 1000);
      const maxCols = resolvePositiveInteger(basePlotSettings.maxCols, 1000);
      const decimationStep = resolvePositiveInteger(
        basePlotSettings.decimationStep,
        1,
      );

      if (xPath) {
        xDataset = plotDatasets.find((dataset) => dataset.path === xPath);
        if (!isNumeric1D(xDataset)) {
          dataView.showPlotError("X dataset must be a numeric 1D array.");
          await resetPlot("Select a numeric 1D dataset for X.");
          return;
        }
        xLength = xDataset.shape?.[0] ?? 0;
      }

      if (plotMode === "heatmap") {
        if (!isNumericDtype(yDataset.dtype)) {
          dataView.showPlotError("Y dataset must be numeric.");
          await resetPlot("Select a numeric dataset for Y.");
          return;
        }
      }

      if (showLoading) {
        dataView.showPlotLoading("Loading plot data…");
      }

      if (plotMode === "heatmap") {
        const shape = yDataset.shape ?? [];
        const rowCount = shape[shape.length - 2] ?? 0;
        const colCount = shape[shape.length - 1] ?? 0;
        const rowRange = resolveIndexRange(rowCount, basePlotSettings, "y");
        const colRange = resolveIndexRange(colCount, basePlotSettings, "x");
        const rowSpan = Math.max(rowRange.end - rowRange.start, 0);
        const colSpan = Math.max(colRange.end - colRange.start, 0);
        const rowStep = resolveSamplingStep(rowSpan, maxRows, decimationStep);
        const colStep = resolveSamplingStep(colSpan, maxCols, decimationStep);
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
        const clampedIndex = Math.min(
          Math.max(sliceIndex ?? 0, 0),
          maxIndex,
        );
        const leadingIndices = leadingDims.map(() => 0);
        if (leadingIndices.length) {
          leadingIndices[safeAxis] = clampedIndex;
        }

        if (resolvedSliceAxis !== safeAxis) {
          resolvedSliceAxis = safeAxis;
        }

        if (axisCount) {
          const sliceLabel = sliceDataset?.name ?? sliceDataset?.path;
          dataView.setPlotSliceAxis(
            shape,
            safeAxis,
            false,
            sliceLabel ?? "Time index",
          );
        }

        let xAxisValues = null;
        let yAxisValues = null;
        let rAxis = null;

        if (xDataset) {
          if (xLength !== colCount) {
            dataView.showPlotError("X dataset length must match R dimension.");
            await resetPlot("X dataset length must match the R dimension.");
            return;
          }
          const xResult = await session.readDataset1D(xPath, {
            start: colRange.start,
            end: colRange.end,
            maxPoints: maxCols,
            step: colStep,
          });
          if (token !== plotToken) {
            return;
          }
          xAxisValues = xResult.values;
        } else {
          rAxis =
            findAxisDatasetByName(
              plotDatasets,
              yDataset.parentPath,
              "r",
              colCount,
            ) ??
            findAxisDatasetByName(
              plotDatasets,
              yDataset.parentPath,
              "dim2",
              colCount,
            );
          if (rAxis) {
            const rResult = await session.readDataset1D(rAxis.path, {
              start: colRange.start,
              end: colRange.end,
              maxPoints: maxCols,
              step: colStep,
            });
            if (token !== plotToken) {
              return;
            }
            xAxisValues = rResult.values;
          }
        }

        const zAxisFromPath = yAxisPath
          ? plotDatasets.find((d) => d.path === yAxisPath)
          : null;
        const zAxis =
          zAxisFromPath ??
          findAxisDatasetByName(
            plotDatasets,
            yDataset.parentPath,
            "z",
            rowCount,
          ) ??
          findAxisDatasetByName(
            plotDatasets,
            yDataset.parentPath,
            "dim1",
            rowCount,
          );
        if (zAxis) {
          const zResult = await session.readDataset1D(zAxis.path, {
            start: rowRange.start,
            end: rowRange.end,
            maxPoints: maxRows,
            step: rowStep,
          });
          if (token !== plotToken) {
            return;
          }
          yAxisValues = zResult.values;
        }
        const hasAxisData =
          (xDataset && zAxis) || (rAxis && zAxis) || (xAxisValues && yAxisValues);
        const scaleMode = basePlotSettings.scaleMode || "auto";

        let shouldEnforceEqualScale = false;
        if (scaleMode === "equal") {
          shouldEnforceEqualScale = true;
        } else if (scaleMode === "auto" && hasAxisData) {
          // Smart default: only enforce equal scaling if aspect ratio is reasonable
          const aspectRatio = Math.max(rowCount, colCount) / Math.min(rowCount, colCount);
          shouldEnforceEqualScale = aspectRatio <= 3;
        }
        // scaleMode === "free" means never enforce equal scaling

        if (shouldEnforceEqualScale) {
          heatmapPlotSettings = {
            ...basePlotSettings,
            equalScale: true,
            ...((!basePlotSettings.aspectRatio ||
            basePlotSettings.aspectRatio === "auto")
              ? { aspectRatio: "1:1" }
              : {}),
          };
        }

        let zValues = [];
        if (shape.length === 3) {
          const frameResult = await session.readDataset3DFrame(yPath, {
            tIndex: clampedIndex,
            rowStart: rowRange.start,
            rowEnd: rowRange.end,
            colStart: colRange.start,
            colEnd: colRange.end,
            maxRows,
            maxCols,
            rowStep,
            colStep,
          });
          if (token !== plotToken) {
            return;
          }
          zValues = frameResult.values;
        } else {
          const heatmapResult = await session.readDatasetND2D(yPath, {
            leadingIndices,
            rowStart: rowRange.start,
            rowEnd: rowRange.end,
            colStart: colRange.start,
            colEnd: colRange.end,
            maxRows,
            maxCols,
            rowStep,
            colStep,
          });
          if (token !== plotToken) {
            return;
          }
          zValues = heatmapResult.values;
        }
        const fallbackCols = zValues[0]?.length ?? 0;
        const fallbackRows = zValues.length ?? 0;
        await disposePlot(dataView.plotContainer);
        dataView.setPlotPlaceholder("");
        await renderHeatmapPlot(
          dataView.plotContainer,
          xAxisValues ??
            Array.from({ length: fallbackCols }, (_, i) => colRange.start + i * colStep),
          yAxisValues ??
            Array.from({ length: fallbackRows }, (_, i) => rowRange.start + i * rowStep),
          zValues,
          {
            xLabel: xAxisValues
              ? xDataset?.path ?? rAxis?.path ?? "R"
              : "R Index",
            yLabel: yAxisValues ? zAxis?.path ?? "Z" : "Z Index",
            zLabel: colorbarDataset?.path ?? yPath,
            plotSettings: heatmapPlotSettings,
            plotOverrides,
          },
        );
        dataView.showPlotError("");
        return;
      }

      if (plotMode === "2d") {
        if (!isNumericDtype(yDataset.dtype)) {
          dataView.showPlotError("Y dataset must be numeric.");
          await resetPlot("Select a numeric dataset for Y.");
          return;
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
        if (resolvedSliceAxis !== sliceAxis) {
          const sliceLabel = sliceDataset?.name ?? sliceDataset?.path;
          dataView.setPlotSliceAxis(
            yDataset.shape,
            resolvedSliceAxis,
            true,
            sliceLabel || undefined,
          );
        }

        if (showAllSeries) {
          const MAX_ALL_SERIES = 30;
          const sliceCount = resolvedSliceAxis === 1 ? cols : rows;
          const cappedCount = Math.min(sliceCount, MAX_ALL_SERIES);
          const xAxisLength = resolvedSliceAxis === 1 ? rows : cols;
          const axisRange = resolveIndexRange(xAxisLength, basePlotSettings, "x");
          const axisSpan = Math.max(axisRange.end - axisRange.start, 0);
          const axisStep = resolveSamplingStep(axisSpan, maxPoints, decimationStep);

          let sharedX = null;
          if (xPath && xDataset && (xDataset.shape?.[0] ?? 0) === xAxisLength) {
            const xResult = await session.readDataset1D(xPath, {
              start: axisRange.start,
              end: axisRange.end,
              maxPoints,
              step: axisStep,
            });
            if (token !== plotToken) {
              return;
            }
            sharedX = Array.from(xResult.values);
          }

          let sliceNames = null;
          if (sliceDataset && isNumeric1D(sliceDataset) && (sliceDataset.shape?.[0] ?? 0) >= cappedCount) {
            try {
              const sliceResult = await session.readDataset1D(slicePath, {
                start: 0,
                end: cappedCount,
                maxPoints: cappedCount,
              });
              if (token !== plotToken) {
                return;
              }
              sliceNames = Array.from(sliceResult.values);
            } catch {
              // ignore, fall back to indices
            }
          }

          const allSeries = [];
          for (let i = 0; i < cappedCount; i++) {
            const yResult = resolvedSliceAxis === 1
              ? await session.readDataset2DColumn(yPath, {
                  colIndex: i,
                  rowStart: axisRange.start,
                  rowEnd: axisRange.end,
                  maxRows: maxPoints,
                  step: axisStep,
                })
              : await session.readDataset2DRow(yPath, {
                  rowIndex: i,
                  colStart: axisRange.start,
                  colEnd: axisRange.end,
                  maxCols: maxPoints,
                  step: axisStep,
                });
            if (token !== plotToken) {
              return;
            }
            if (!sharedX) {
              sharedX = Array.from(
                { length: yResult.values.length },
                (_, idx) => axisRange.start + idx * axisStep,
              );
            }
            const name = sliceNames ? String(sliceNames[i]) : String(i);
            allSeries.push({ x: sharedX, y: Array.from(yResult.values), name });
          }

          if (allSeries.length === 0) {
            await resetPlot("No series to display.");
            return;
          }

          if (sliceCount > MAX_ALL_SERIES) {
            dataView.showPlotNote(`Showing first ${MAX_ALL_SERIES} of ${sliceCount} series.`);
          }

          await disposePlot(dataView.plotContainer);
          dataView.setPlotPlaceholder("");
          await renderXYPlotSeries(dataView.plotContainer, allSeries, {
            xLabel: xPath ? xPath : "Index",
            yLabel: yPath,
            plotSettings,
            plotOverrides,
          });
          dataView.showPlotError("");
          return;
        }

        const fallbackSliceAxis = resolvedSliceAxis;
        let candidateAxes = [fallbackSliceAxis];
        if (xLength !== null) {
          const axisCandidates = [];
          if (xLength === rows) {
            axisCandidates.push(1);
          }
          if (xLength === cols) {
            axisCandidates.push(0);
          }
          if (axisCandidates.length === 0) {
            dataView.showPlotError(
              "X and Y datasets must have the same length.",
            );
            await resetPlot("X and Y datasets must share the same length.");
            return;
          }
          candidateAxes = [
            axisCandidates.includes(fallbackSliceAxis)
              ? fallbackSliceAxis
              : axisCandidates[0],
            ...axisCandidates.filter(
              (axis) => axis !== fallbackSliceAxis,
            ),
          ];
        }

        let aligned = false;
        let lastLengthMismatch = false;
        for (const axis of candidateAxes) {
          yLength = axis === 1 ? rows : cols;
          const axisRange = resolveIndexRange(yLength, basePlotSettings, "x");
          const axisSpan = Math.max(axisRange.end - axisRange.start, 0);
          const axisStep = resolveSamplingStep(
            axisSpan,
            maxPoints,
            decimationStep,
          );
          const maxIndex = Math.max((axis === 1 ? cols : rows) - 1, 0);
          const clampedIndex = Math.min(
            Math.max(sliceIndex ?? 0, 0),
            maxIndex,
          );
          const yResult =
            axis === 1
              ? await session.readDataset2DColumn(yPath, {
                  colIndex: clampedIndex,
                  rowStart: axisRange.start,
                  rowEnd: axisRange.end,
                  maxRows: maxPoints,
                  step: axisStep,
                })
              : await session.readDataset2DRow(yPath, {
                  rowIndex: clampedIndex,
                  colStart: axisRange.start,
                  colEnd: axisRange.end,
                  maxCols: maxPoints,
                  step: axisStep,
                });
          if (token !== plotToken) {
            return;
          }
          yValues = yResult.values;

          if (xPath) {
            if ((xDataset.shape?.[0] ?? 0) !== yLength) {
              lastLengthMismatch = true;
              continue;
            }

            const xResult = await session.readDataset1D(xPath, {
              start: axisRange.start,
              end: axisRange.end,
              maxPoints,
              step: axisStep,
            });
            if (token !== plotToken) {
              return;
            }

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
            dataView.showPlotError(
              "X and Y datasets must have the same length.",
            );
            await resetPlot("X and Y datasets must share the same length.");
            return;
          }

          dataView.showPlotError("X and Y datasets could not be aligned.");
          await resetPlot("X and Y datasets could not be aligned.");
          return;
        }
      } else {
        if (!isNumeric1D(yDataset)) {
          dataView.showPlotError("Y dataset must be a numeric 1D array.");
          await resetPlot("Select a numeric 1D dataset for Y.");
          return;
        }

        yLength = yDataset.shape?.[0] ?? 0;
        const axisRange = resolveIndexRange(yLength, basePlotSettings, "x");
        const axisSpan = Math.max(axisRange.end - axisRange.start, 0);
        const axisStep = resolveSamplingStep(
          axisSpan,
          maxPoints,
          decimationStep,
        );
        defaultAxisRange = axisRange;
        defaultAxisStep = axisStep;
        const yResult = await session.readDataset1D(yPath, {
          start: axisRange.start,
          end: axisRange.end,
          maxPoints,
          step: axisStep,
        });
        if (token !== plotToken) {
          return;
        }
        yValues = yResult.values;
      }

      if (plotMode !== "2d") {
        if (xPath) {
          if ((xDataset.shape?.[0] ?? 0) !== yLength) {
            dataView.showPlotError(
              "X and Y datasets must have the same length.",
            );
            await resetPlot("X and Y datasets must share the same length.");
            return;
          }

          const axisRange = resolveIndexRange(yLength, basePlotSettings, "x");
          const axisSpan = Math.max(axisRange.end - axisRange.start, 0);
          const axisStep = resolveSamplingStep(
            axisSpan,
            maxPoints,
            decimationStep,
          );
          const xResult = await session.readDataset1D(xPath, {
            start: axisRange.start,
            end: axisRange.end,
            maxPoints,
            step: axisStep,
          });
          if (token !== plotToken) {
            return;
          }

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
          dataView.showPlotError("X and Y datasets could not be aligned.");
          await resetPlot("X and Y datasets could not be aligned.");
          return;
        }

        xValues = finalX;
      }

      await disposePlot(dataView.plotContainer);
      dataView.setPlotPlaceholder("");
      await renderXYPlot(dataView.plotContainer, xValues, yValues, {
        xLabel: xPath ? xPath : "Index",
        yLabel: yPath,
        plotSettings,
        plotOverrides,
      });
      dataView.showPlotError("");
    } catch (error) {
      if (token === plotToken) {
        dataView.showPlotError(error.message);
        await resetPlot("Unable to render the selected datasets.");
      }
    } finally {
      if (token === plotToken) {
        dataView.showPlotLoading("");
      }
    }
  }

  async function loadDatasetPreview(
    node,
    info,
    indices = [],
    token,
  ) {
    const session = getCurrentSession();
    if (!session) {
      return;
    }
    const shape = info.shape ?? [];
    const [rows = 0, cols = 0] = shape.length >= 2 ? shape.slice(-2) : [0, 0];
    const previewLimits = shape.length <= 1
      ? { maxPoints: shape[0] ?? 0 }
      : { maxRows: rows, maxCols: cols };
    const preview = await session.getDatasetPreviewAsync(node.path, {
      ...previewLimits,
      leadingIndices: indices,
    });
    if (token !== selectionToken) {
      return;
    }
    const showSliceControls = (info.shape ?? []).length > 2;
    const nextLeadingIndices = preview.leadingIndices ?? indices;
    if ((info.shape ?? []).length > 2) {
      node.previewIndices = nextLeadingIndices;
    }
    const sliceConfig = showSliceControls
      ? {
          shape: info.shape ?? [],
          leadingIndices: nextLeadingIndices,
          onRequest: async ({ leadingIndices }) => {
            try {
              showAppError("");
              dataView.renderLoadingState("Loading preview slice…");
              await loadDatasetPreview(
                node,
                info,
                leadingIndices ?? nextLeadingIndices,
                token,
              );
            } catch (error) {
              showAppError(error.message);
            }
          },
        }
      : null;

    dataView.renderDataset(info, preview, sliceConfig);
  }

  async function handleSelect(node) {
    const targetFileKey = node.fileKey ?? currentFileKey;
    if (!targetFileKey) {
      return;
    }
    if (targetFileKey !== currentFileKey) {
      await switchToFile(targetFileKey);
      return;
    }
    const session = getSessionForFileKey(targetFileKey);
    if (!session) {
      return;
    }
    setPrimaryTab("dataset");
    const token = (selectionToken += 1);
    showAppError("");
    dataView.setTabsEnabled(true);
    if (node.type === "group") {
      dataView.setActiveTab("info");
    } else if (node.type === "dataset") {
      dataView.setActiveTab("raw");
    }
    dataView.renderLoadingState("Loading selection…");

    try {
      const info = await session.getNodeInfo(node.path);
      if (token !== selectionToken) {
        return;
      }
      info.path = node.path;

      if (info.type === "group") {
        const children = await session.listChildren(node.path);
        if (token !== selectionToken) {
          return;
        }
        dataView.renderGroup(info, children);
      } else if (info.type === "dataset") {
        dataView.renderLoadingState("Loading dataset…");
        await loadDatasetPreview(node, info, node.previewIndices ?? [], token);
        dataView.setPlotSelection({ type: info.type, path: node.path });
      } else {
        dataView.renderEmptyState("Unsupported node type.");
      }
    } catch (error) {
      if (token === selectionToken) {
        showAppError(error.message);
      }
    }
  }

  function handleOpen(node) {
    const targetFileKey = node.fileKey ?? currentFileKey;
    if (!targetFileKey || targetFileKey !== currentFileKey) {
      return;
    }
    if (!getCurrentSession() || node.type !== "dataset") {
      return;
    }
    setPrimaryTab("dataset");
    dataView.setActiveTab("plot");
    dataView.setPlotSelection({ type: node.type, path: node.path });
  }

  layout.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      await openFileSession(file, {
        displayName: file.name,
        pathHint: file.path ?? null,
      });
    } catch (error) {
      treeView.setStatus("");
      showAppError(error.message);
    }
  });

  layout.fileOpen.addEventListener("click", async () => {
    if (typeof window.showOpenFilePicker !== "function") {
      layout.fileInput.click();
      return;
    }

    try {
      const [handle] = await window.showOpenFilePicker({
        multiple: false,
        types: [
          {
            description: "HDF5 files",
            accept: {
              "application/x-hdf5": [".h5", ".hdf5", ".hdf"],
            },
          },
        ],
      });

      if (!handle) {
        return;
      }

      layout.fileInput.value = "";
      await openFileSession(handle, {
        displayName: handle.name,
        handle,
        pathHint: null,
      });
    } catch (error) {
      if (error?.name === "AbortError") {
        return;
      }
      treeView.setStatus("");
      showAppError(error.message);
    }
  });

  function resolveDashboardFileReference() {
    const dashboards = dashboardView?.getDashboards() ?? [];
    if (!dashboards.length) {
      return null;
    }
    const activeId = dashboardView.getActiveDashboardId?.();
    const orderedDashboards = activeId
      ? [
          dashboards.find((dashboard) => dashboard.id === activeId),
          ...dashboards.filter((dashboard) => dashboard.id !== activeId),
        ].filter(Boolean)
      : dashboards;

    for (const dashboard of orderedDashboards) {
      if (dashboard?.fileKey) {
        return { fileKey: dashboard.fileKey, fileLabel: dashboard.fileLabel };
      }
      const plotWithFile = dashboard?.plots?.find((plot) => plot.fileKey);
      if (plotWithFile?.fileKey) {
        return {
          fileKey: plotWithFile.fileKey,
          fileLabel: plotWithFile.fileLabel ?? dashboard.fileLabel,
        };
      }
    }
    return null;
  }

  resetAppState();
  setFileDisplay("");
  void (async () => {
    // ── Load from ?file=<URL> ─────────────────────────────────────────
    let pendingErrorNode = null;
    const remoteFileUrl = new URLSearchParams(location.search).get("file");
    if (remoteFileUrl) {
      // Validate: must be a parseable https:// URL
      let parsedRemoteUrl;
      try {
        parsedRemoteUrl = new URL(remoteFileUrl);
      } catch {
        parsedRemoteUrl = null;
      }
      if (!parsedRemoteUrl || parsedRemoteUrl.protocol !== "https:") {
        history.replaceState(null, "", location.pathname);
        // fall through to OPFS restoration
      } else {
        const fileName =
          parsedRemoteUrl.pathname.split("/").pop()?.split("?")[0] || "file.h5";
        let didCache = false;
        let fileKey = null;
        try {
          // Confirm before issuing any network request
          const confirmed = window.confirm(
            `Load file from external URL?\n\n${parsedRemoteUrl.origin}${parsedRemoteUrl.pathname}\n\nOnly proceed if you trust this source.`,
          );
          if (!confirmed) {
            history.replaceState(null, "", location.pathname);
            return;
          }

          treeView.setStatus("Fetching file…");
          const response = await fetch(parsedRemoteUrl.href);
          if (!response.ok)
            throw new Error(`Server returned ${response.status}`);
          const blob = await response.blob();
          const header = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
          const HDF5_MAGIC = [0x89, 0x48, 0x44, 0x46, 0x0d, 0x0a, 0x1a, 0x0a];
          if (!HDF5_MAGIC.every((b, i) => header[i] === b))
            throw new Error("URL does not point to a valid HDF5 file.");

          // Derive OPFS key from content hash, not the attacker-controlled URL
          const hashBuffer = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
          const hashHex = Array.from(new Uint8Array(hashBuffer))
            .map((b) => b.toString(16).padStart(2, "0"))
            .join("");
          fileKey = `remote:${hashHex}`;

          if (!(await hasFileInOpfs(fileKey))) {
            const file = new File([blob], fileName);
            const cached = await cacheFileInOpfs(file, fileKey, fileName);
            if (!cached) throw new Error("Could not save file to browser storage.");
            didCache = true;
          }
          await restoreFileTreeForFileKey(fileKey, fileName);
          // SUCCESS: skip OPFS restoration
          return;
        } catch (err) {
          if (didCache && fileKey) {
            await removeFileFromOpfs(fileKey);
            removeRecentOpfsEntry(fileKey);
          }
          pendingErrorNode = { name: "Invalid URL" };
        } finally {
          history.replaceState(null, "", location.pathname);
        }
        // ERROR: fall through to OPFS restoration below
      }
    }
    // ─────────────────────────────────────────────────────────────────

    async function doOpfsRestore() {
      const dashboardReference = resolveDashboardFileReference();
      const recentEntries = loadRecentOpfsEntries();
      const opfsEntries =
        recentEntries.length > 0 ? recentEntries : await listOpfsFileKeys();
      const validatedEntries = [];

      for (const entry of opfsEntries) {
        if (!entry?.fileKey) {
          continue;
        }
        const displayName = entry.fileLabel ?? entry.displayName ?? null;
        if (!(await hasFileInOpfs(entry.fileKey, { displayName }))) {
          removeRecentOpfsEntry(entry.fileKey);
          continue;
        }
        validatedEntries.push({
          fileKey: entry.fileKey,
          fileLabel: displayName,
        });
        if (validatedEntries.length >= recentOpfsLimit) {
          break;
        }
      }

      if (validatedEntries.length > 0) {
        persistRecentOpfsEntries(validatedEntries);
        for (const entry of validatedEntries) {
          await ensureSessionForFileKey(entry.fileKey, {
            fileLabel: entry.fileLabel,
          });
        }
      }

      if (dashboardReference?.fileKey) {
        await restoreFileTreeForFileKey(
          dashboardReference.fileKey,
          dashboardReference.fileLabel,
        );
        return;
      }

      if (validatedEntries[0]?.fileKey) {
        await restoreFileTreeForFileKey(
          validatedEntries[0].fileKey,
          validatedEntries[0].fileLabel,
        );
      }
    }

    await doOpfsRestore();

    if (pendingErrorNode) {
      treeView.setStatus("");
      let errorItem;
      const errorNode = {
        name: pendingErrorNode.name,
        path: "/",
        type: "group",
        isFileRoot: true,
        isError: true,
        children: [],
        expanded: false,
        onDismiss: () => { errorItem?.remove(); void doOpfsRestore(); },
      };
      errorItem = treeView.prependNode(errorNode);
    }
  })();
}
