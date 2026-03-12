export function createMainLayout() {
  const mainLayout = document.querySelector(".main-layout");
  const fileInput = document.querySelector("#file-input");
  const fileOpen = document.querySelector("#file-open");
  const fileSwitcher = document.querySelector("#file-switcher");
  const fileSwitcherButtons = document.querySelector("#file-switcher-buttons");
  const treeToggle = document.querySelector("#tree-toggle");
  const treeRoot = document.querySelector("#tree-root");
  const treeStatus = document.querySelector("#tree-status");
  const treeFilter = document.querySelector("#tree-filter");
  const dataView = document.querySelector(".data-view");
  const tabList = document.querySelector(".tabs");
  const addDashboard = document.querySelector("#add-dashboard");
  const dashboardPanels = document.querySelector("#dashboard-panels");
  const datasetPanel = document.querySelector('[data-panel="dataset"]');
  const viewerTabs = document.querySelector(".viewer-tabs");
  const viewButtons = document.querySelectorAll(".viewer-tab-button");
  const rawPanel = document.querySelector("#raw-panel");
  const plotPanel = document.querySelector("#plot-panel");
  const infoPanel = document.querySelector("#info-panel");
  const errorPanel = document.querySelector("#data-error");
  const dataMeta = document.querySelector("#data-meta");
  const sliceControls = document.querySelector("#slice-controls");
  const plotControlsSlot = document.querySelector("#plot-controls-slot");

  if (
    !mainLayout ||
    !fileInput ||
    !fileOpen ||
    !treeToggle ||
    !treeRoot ||
    !treeStatus ||
    !treeFilter ||
    !dataView ||
    !tabList ||
    !dashboardPanels ||
    !datasetPanel ||
    !viewerTabs ||
    !rawPanel ||
    !plotPanel ||
    !infoPanel ||
    !errorPanel ||
    !dataMeta ||
    !sliceControls ||
    !viewButtons.length
  ) {
    return null;
  }

  return {
    mainLayout,
    fileInput,
    fileOpen,
    fileSwitcher,
    fileSwitcherButtons,
    treeToggle,
    treeRoot,
    treeStatus,
    treeFilter,
    dataView,
    tabList,
    addDashboard,
    dashboardPanels,
    datasetPanel,
    viewerTabs,
    viewButtons,
    rawPanel,
    plotPanel,
    infoPanel,
    errorPanel,
    dataMeta,
    sliceControls,
    plotControlsSlot,
  };
}
