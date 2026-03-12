import { isNumericDtype } from "../../data/index.js";
import {
  applyPlotOverrides,
  buildHeatmapSpec,
  buildPlotSpec,
} from "../../viz/index.js";
import { icons } from "../icons.js";

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function formatShape(shape) {
  if (!Array.isArray(shape) || !shape.length) {
    return "";
  }

  return shape.join("×");
}

function formatDtype(dtype) {
  if (!dtype || dtype === "unknown") {
    return "";
  }

  if (typeof dtype !== "string") {
    return String(dtype);
  }

  const match = dtype.match(/^[<>|]?([ifucb])(\d+)$/i);
  if (!match) {
    return dtype;
  }

  const [, kind, bytes] = match;
  const bitSize = Number(bytes) * 8;
  const kindMap = {
    i: "Int",
    u: "UInt",
    f: "Float",
    c: "Complex",
    b: "Bool",
  };
  const prefix = kindMap[kind.toLowerCase()] ?? dtype;
  if (!bitSize || Number.isNaN(bitSize)) {
    return prefix;
  }
  return `${prefix}${bitSize}`;
}

function formatNodeType(nodeType) {
  if (!nodeType) {
    return "";
  }
  return nodeType;
}

function formatAttributeValue(value) {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      return serialized === "{}" ? "Object" : serialized;
    } catch (error) {
      return "Object";
    }
  }
  return String(value);
}

function renderObjectsRow(attributes) {
  if (!attributes?.length) {
    return null;
  }

  const row = document.createElement("div");
  row.className = "meta-row meta-row--stack";
  const labelEl = document.createElement("strong");
  labelEl.textContent = "Objects";
  row.appendChild(labelEl);

  const list = document.createElement("ul");
  list.className = "muted meta-list meta-list--scroll meta-list--objects";
  attributes.forEach(({ key, value }) => {
    const item = document.createElement("li");
    const formattedValue = formatAttributeValue(value);
    item.textContent = formattedValue ? `${key} ${formattedValue}` : key;
    list.appendChild(item);
  });
  row.appendChild(list);
  return row;
}

function normalizeAxisName(name) {
  if (!name) {
    return "";
  }
  return name.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function formatDatasetPath(dataset) {
  const path = dataset?.path ?? "";
  // Remove trailing slash from dataset paths
  return path.endsWith("/") ? path.slice(0, -1) : path;
}

function formatDatasetDetail(dataset) {
  return formatShape(dataset?.shape);
}

function formatDatasetLabel(dataset) {
  const path = formatDatasetPath(dataset);
  const detail = formatDatasetDetail(dataset);
  if (!detail) {
    return path;
  }
  return `[${detail}] ${path}`;
}

function formatYDatasetLabel(dataset, sliceAxis, sliceAxisName) {
  const path = formatDatasetPath(dataset);
  const shape = dataset?.shape;
  if (!shape || shape.length < 2 || sliceAxis == null) {
    const detail = formatShape(shape);
    return detail ? `[${detail}] ${path}` : path;
  }
  const plotParts = shape.filter((_, i) => i !== sliceAxis).map(String);
  const sliceName = sliceAxisName ?? String(shape[sliceAxis]);
  return `[${plotParts.join("×")} × <${sliceName}>] ${path}`;
}

const opfsNamePattern = /^[A-Za-z0-9_-]+\\.h5$/;

function isOpfsEncodedName(name) {
  return Boolean(name && opfsNamePattern.test(name));
}


function isNumeric1D(dataset) {
  return (
    dataset &&
    Array.isArray(dataset.shape) &&
    dataset.shape.length === 1 &&
    isNumericDtype(dataset.dtype)
  );
}

function isNumeric2D(dataset) {
  return (
    dataset &&
    Array.isArray(dataset.shape) &&
    dataset.shape.length === 2 &&
    isNumericDtype(dataset.dtype)
  );
}

function isNumeric3D(dataset) {
  return (
    dataset &&
    Array.isArray(dataset.shape) &&
    dataset.shape.length >= 3 &&
    isNumericDtype(dataset.dtype)
  );
}

let selectorId = 0;

function createDatasetSelector(labelText, placeholderText) {
  const wrapper = document.createElement("div");
  wrapper.className = "plot-selector";

  const label = document.createElement("label");
  label.className = "plot-selector-label";
  const prefix = document.createElement("strong");
  prefix.className = "plot-selector-prefix";
  prefix.textContent = labelText;
  const baseLabel = labelText.replace(/:$/, "");

  const selectorInput = document.createElement("input");
  selectorInput.type = "search";
  selectorInput.placeholder = placeholderText;
  selectorInput.className = "plot-selector-search";
  const listId = `plot-selector-list-${selectorId += 1}`;
  selectorInput.setAttribute("list", listId);

  const datalist = document.createElement("datalist");
  datalist.id = listId;

  label.appendChild(prefix);
  label.appendChild(selectorInput);
  label.appendChild(datalist);
  wrapper.appendChild(label);

  return {
    wrapper,
    selectorInput,
    datalist,
    prefix,
    baseLabel,
    optionLabels: new Map(),
  };
}

function createTabbedDatasetSelector() {
  // Container for entire component
  const wrapper = document.createElement("div");
  wrapper.className = "plot-tabbed-selector";

  // Tab buttons container
  const tabsContainer = document.createElement("div");
  tabsContainer.className = "plot-selector-tabs";
  tabsContainer.setAttribute("role", "tablist");

  // Create 4 tab buttons
  const roles = [
    { id: "x", icon: icons.axisX, title: "X-axis dataset" },
    { id: "y", icon: icons.axisY, title: "Y-axis dataset" },
    { id: "slider", icon: icons.adjustmentsHorizontal, title: "Slider dataset" },
    { id: "colorbar", icon: icons.palette, title: "Colorbar dataset" },
  ];

  const tabs = {};
  roles.forEach((role, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "plot-selector-tab";
    tab.innerHTML = role.icon;
    tab.title = role.title;
    tab.dataset.role = role.id;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", role.id === "y" ? "true" : "false");
    if (role.id === "y") {
      tab.classList.add("active");
    }
    tabsContainer.appendChild(tab);
    tabs[role.id] = tab;
  });

  // Shared input field
  const inputWrapper = document.createElement("label");
  inputWrapper.className = "plot-selector-input-wrapper";

  const input = document.createElement("input");
  input.type = "search";
  input.className = "plot-selector-search";
  const listId = `plot-selector-list-${selectorId += 1}`;
  input.setAttribute("list", listId);
  input.placeholder = "Select dataset...";

  const datalist = document.createElement("datalist");
  datalist.id = listId;

  inputWrapper.appendChild(input);
  wrapper.appendChild(tabsContainer);
  wrapper.appendChild(inputWrapper);
  wrapper.appendChild(datalist);

  return {
    wrapper,
    tabs,
    input,
    datalist,
    activeRole: "y",
    optionLabels: new Map(),
    // Track selections for each role
    roleSelections: {
      y: { path: "", shape: null },
      x: { path: "", shape: null },
      slider: { path: "", shape: null },
      colorbar: { path: "", shape: null }
    }
  };
}

function renderPreviewTable(rows, cornerContent = null) {
  const table = document.createElement("table");
  table.className = "preview-table";

  const thead = document.createElement("thead");
  const headerRow = document.createElement("tr");
  const corner = document.createElement("th");
  if (cornerContent) {
    corner.appendChild(cornerContent);
  } else {
    corner.textContent = "";
  }
  headerRow.appendChild(corner);

  const colCount = rows[0]?.length ?? 0;
  for (let col = 0; col < colCount; col += 1) {
    const th = document.createElement("th");
    th.textContent = col.toString();
    headerRow.appendChild(th);
  }
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement("tbody");
  rows.forEach((rowValues, rowIndex) => {
    const tr = document.createElement("tr");
    const rowLabel = document.createElement("th");
    rowLabel.textContent = rowIndex.toString();
    tr.appendChild(rowLabel);
    rowValues.forEach((value) => {
      const td = document.createElement("td");
      td.textContent = String(value);
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);

  return table;
}

function wrapPreviewTable(table) {
  const wrapper = document.createElement("div");
  wrapper.className = "preview-table-wrapper";
  wrapper.appendChild(table);
  return wrapper;
}

function renderPreview(preview, sliceControlsContent = null) {
  const container = document.createElement("div");
  container.className = "section-block preview-section";

  if (preview.kind === "unavailable") {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = preview.message;
    container.appendChild(message);
    return container;
  }

  if (preview.kind === "none") {
    const message = document.createElement("p");
    message.className = "muted";
    message.textContent = "No preview available.";
    container.appendChild(message);
    return container;
  }

  if (preview.kind === "0d") {
    container.appendChild(wrapPreviewTable(renderPreviewTable([[preview.value]])));
  }

  if (preview.kind === "1d") {
    const rows = preview.values.map((value) => [value]);
    container.appendChild(wrapPreviewTable(renderPreviewTable(rows)));
  }

  if (preview.kind === "2d") {
    container.appendChild(wrapPreviewTable(renderPreviewTable(preview.rows, sliceControlsContent)));
  }

  if (preview.truncated) {
    const note = document.createElement("p");
    note.className = "muted";
    note.textContent = preview.truncated;
    container.appendChild(note);
  }

  return container;
}


function renderChildrenRow(children) {
  if (!children?.length) {
    return null;
  }

  const row = document.createElement("div");
  row.className = "meta-row meta-row--stack";

  const labelEl = document.createElement("strong");
  labelEl.textContent = `Children (${children.length})`;
  row.appendChild(labelEl);

  const list = document.createElement("ul");
  list.className = "muted meta-list";
  children.forEach((child) => {
    const item = document.createElement("li");
    item.textContent = `${child.name} (${child.type})`;
    list.appendChild(item);
  });
  row.appendChild(list);

  return row;
}

function renderDatasetMetaRow(target, info) {
  clearElement(target);
  target.textContent = `${info.path} [${formatShape(info.shape)}] ${formatDtype(info.dtype)}`;
}

function renderGroupMeta(info) {
  const container = document.createElement("div");
  container.className = "section-block";

  container.appendChild(renderInfoRow("Path", info.path));
  container.appendChild(renderInfoRow("Type", formatNodeType(info.type)));
  container.appendChild(renderInfoRow("Shape", formatShape(info.shape)));
  const objectsRow = renderObjectsRow(info.attributes);
  if (objectsRow) {
    container.appendChild(objectsRow);
  }

  return container;
}

function renderInfoRow(label, value) {
  const row = document.createElement("p");
  row.className = "meta-row";
  const labelEl = document.createElement("strong");
  labelEl.textContent = label;
  const valueEl = document.createElement("span");
  valueEl.className = "meta-value";
  valueEl.textContent = value;
  if (typeof value === "string") {
    valueEl.title = value;
  }
  row.appendChild(labelEl);
  row.appendChild(valueEl);
  return row;
}

function renderDatasetDetails(info) {
  const container = document.createElement("div");
  container.className = "section-block";

  container.appendChild(renderInfoRow("Path", info.path));
  container.appendChild(renderInfoRow("Type", formatNodeType(info.type)));
  container.appendChild(renderInfoRow("Shape", formatShape(info.shape)));
  const objectsRow = renderObjectsRow(info.attributes);
  if (objectsRow) {
    container.appendChild(objectsRow);
  }

  return container;
}

function renderSliceControls(shape, leadingIndices, onRequest) {
  const container = document.createElement("div");
  container.className = "preview-controls";

  const inputs = [];

  shape.slice(0, -2).forEach((dimensionSize, index) => {
    const label = document.createElement("label");
    label.setAttribute("aria-label", `Dim ${index} index`);

    const input = document.createElement("input");
    input.type = "number";
    input.min = "0";
    input.max = String(Math.max(dimensionSize - 1, 0));
    input.value = String(leadingIndices[index] ?? 0);
    input.setAttribute("title", `Dim ${index} index`);

    label.appendChild(input);
    container.appendChild(label);
    inputs.push(input);
    input.addEventListener("change", () => {
      const indices = inputs.map((target, targetIndex) => {
        const value = Number.parseInt(target.value, 10);
        if (Number.isNaN(value)) {
          return 0;
        }
        const max = shape[targetIndex] - 1;
        return Math.min(Math.max(value, 0), max);
      });
      onRequest({
        leadingIndices: indices,
      });
    });
  });
  return container;
}

export function createDataView({
  viewButtons,
  rawPanel,
  plotPanel,
  infoPanel,
  errorPanel,
  dataMeta,
  sliceControls,
  plotControlsSlot,
  plotSettings: initialPlotSettings,
  onPlotRequest,
  onPlotTabOpen,
  getDashboards,
  getCurrentFileKey,
  getPlotFiles,
  getPlotDatasets,
  addPlotToDashboard,
  createDashboard,
  activateDashboard,
  onPlotConfigChange,
}) {
  let activeTab = "info";
  let hasDatasetMeta = false;
  let hasSliceControls = false;
  let plotDatasets = [];
  let plotSettings = structuredClone(initialPlotSettings ?? {});
  let plotOverrides = null;
  let plotControlId = 0;
  let plotSyncTarget = null;
  let addToDashboardEnabled = false;
  let plotFileKey = null;
  let plotFileLabel = "";
  let plotFileOptions = [];
  let plotSelection = {
    xPath: "",
    yPath: "",
    yAxisPath: "",
    slicePath: "",
    colorbarPath: "",
    yMode: "1d",
    sliceIndex: 0,
    sliceAxis: 0,
    showAllSeries: false,
  };
  let plotFilters = {
    x: "",
    y: "",
    slice: "",
    colorbar: "",
  };
  let plotNoteMessage = "";
  let plotLoadingMessage = "";
  function nextControlId(prefix) {
    plotControlId += 1;
    return `plot-custom-${prefix}-${plotControlId}`;
  }

  function createField(labelText, input, { hint } = {}) {
    const wrapper = document.createElement("div");
    wrapper.className = "plot-customize-field";
    if (hint) {
      const hintEl = document.createElement("p");
      hintEl.className = "plot-customize-hint";
      hintEl.textContent = hint;
      wrapper.appendChild(hintEl);
    }
    const label = document.createElement("label");
    label.className = "plot-customize-label";
    label.textContent = labelText;
    if (input.id) {
      label.setAttribute("for", input.id);
    }
    wrapper.appendChild(label);
    wrapper.appendChild(input);
    return wrapper;
  }

  function createSection(titleText) {
    const section = document.createElement("section");
    section.className = "plot-customize-section";
    if (titleText) {
      const title = document.createElement("p");
      title.className = "plot-customize-title";
      title.textContent = titleText;
      section.appendChild(title);
    }
    return section;
  }

  function parseNumberValue(value, fallback) {
    const parsed = Number.parseFloat(value);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return parsed;
  }

  function parseIntegerValue(value, fallback) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return fallback;
    }
    return parsed;
  }

  const plotElements = (() => {
    clearElement(plotPanel);

    const container = document.createElement("div");
    container.className = "plotly-panel";

    const controls = document.createElement("div");
    controls.className = "plot-controls";

    const fileSelector = createDatasetSelector("File:", "Select file");
    fileSelector.wrapper.hidden = true;
    fileSelector.wrapper.setAttribute("aria-hidden", "true");

    const tabbedSelector = createTabbedDatasetSelector();

    const customizeEntry = document.createElement("div");
    customizeEntry.className = "plot-customize-entry";
    const customizeButton = document.createElement("button");
    customizeButton.type = "button";
    customizeButton.className = "plot-customize-button";
    customizeButton.innerHTML = icons.settings;
    customizeButton.title = "Customize";
    customizeEntry.appendChild(customizeButton);

    const dashboardEntry = document.createElement("div");
    dashboardEntry.className = "plot-dashboard-entry";
    const addToDashboardButton = document.createElement("button");
    addToDashboardButton.type = "button";
    addToDashboardButton.className = "plot-add-dashboard-button";
    addToDashboardButton.innerHTML = icons.plus;
    addToDashboardButton.title = "Add to dashboard";
    addToDashboardButton.disabled = true;
    dashboardEntry.appendChild(addToDashboardButton);

    controls.appendChild(dashboardEntry);
    controls.appendChild(tabbedSelector.wrapper);
    controls.appendChild(fileSelector.wrapper);
    controls.appendChild(customizeEntry);

    const sliceControls = document.createElement("div");
    sliceControls.className = "plot-slice-controls";
    sliceControls.hidden = true;

    const sliceLabel = document.createElement("label");
    sliceLabel.className = "plot-slice-label";

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

    sliceLabel.appendChild(sliceRange);
    sliceLabel.appendChild(sliceNumber);
    sliceControls.appendChild(sliceLabel);

    const sliceLabelText = document.createElement("span");
    sliceLabelText.className = "plot-slice-label-text muted";
    sliceLabelText.hidden = true;
    sliceControls.appendChild(sliceLabelText);

    const allSeriesButton = document.createElement("button");
    allSeriesButton.type = "button";
    allSeriesButton.className = "plot-all-series-button";
    allSeriesButton.title = "Show all series";
    allSeriesButton.innerHTML = icons.arrowsExchange;
    allSeriesButton.hidden = true;
    sliceControls.appendChild(allSeriesButton);

    const status = document.createElement("div");
    status.className = "plot-status";

    const note = document.createElement("p");
    note.className = "plot-note muted";
    note.hidden = true;

    const error = document.createElement("p");
    error.className = "plot-error";
    error.hidden = true;

    status.appendChild(note);
    status.appendChild(error);

    const plotArea = document.createElement("div");
    plotArea.className = "plot-area";

    const placeholder = document.createElement("p");
    placeholder.className = "muted plot-placeholder";
    placeholder.textContent = "";
    placeholder.hidden = true;
    plotArea.appendChild(placeholder);

    const plotCanvas = document.createElement("div");
    plotCanvas.className = "plotly-canvas";
    plotArea.appendChild(plotCanvas);

    const customizeOverlay = document.createElement("div");
    customizeOverlay.className = "plot-customize-overlay";
    customizeOverlay.hidden = true;

    const customizePanel = document.createElement("aside");
    customizePanel.className = "plot-customize-panel";
    customizePanel.hidden = true;
    customizePanel.setAttribute("aria-hidden", "true");
    const customizePanelId = nextControlId("panel");
    customizePanel.id = customizePanelId;
    customizeButton.setAttribute("aria-controls", customizePanelId);
    customizeButton.setAttribute("aria-expanded", "false");

    const customizeHeader = document.createElement("div");
    customizeHeader.className = "plot-customize-header";
    const customizeTitle = document.createElement("h3");
    customizeTitle.className = "sr-only";
    customizeTitle.textContent = "Customize plot";
    const customizeActions = document.createElement("div");
    customizeActions.className = "plot-customize-actions";
    const resetButton = document.createElement("button");
    resetButton.type = "button";
    resetButton.className = "plot-customize-reset";
    resetButton.innerHTML = icons.rotate;
    resetButton.title = "Reset";
    customizeActions.appendChild(resetButton);
    customizeHeader.appendChild(customizeTitle);
    customizeHeader.appendChild(customizeActions);

    const customizeBody = document.createElement("div");
    customizeBody.className = "plot-customize-body";

    const labelsSection = createSection("Labels");
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.id = nextControlId("title");
    titleInput.placeholder = "Optional plot title";
    labelsSection.appendChild(createField("Plot title", titleInput));
    const xAxisLabelInput = document.createElement("input");
    xAxisLabelInput.type = "text";
    xAxisLabelInput.id = nextControlId("x-label");
    xAxisLabelInput.placeholder = "Uses X dataset label by default";
    labelsSection.appendChild(createField("X axis label", xAxisLabelInput));
    const yAxisLabelInput = document.createElement("input");
    yAxisLabelInput.type = "text";
    yAxisLabelInput.id = nextControlId("y-label");
    yAxisLabelInput.placeholder = "Uses Y dataset label by default";
    labelsSection.appendChild(createField("Y axis label", yAxisLabelInput));
    const sliderLabelInput = document.createElement("input");
    sliderLabelInput.type = "text";
    sliderLabelInput.id = nextControlId("slider-label");
    sliderLabelInput.placeholder = "Uses slice dataset label by default";
    labelsSection.appendChild(createField("Slider label", sliderLabelInput));
    const colorbarLabelInput = document.createElement("input");
    colorbarLabelInput.type = "text";
    colorbarLabelInput.id = nextControlId("colorbar-label");
    colorbarLabelInput.placeholder = "Uses colorbar dataset label by default";
    labelsSection.appendChild(createField("Colorbar label", colorbarLabelInput));

    const axesSection = createSection("Axes");
    const xScaleSelect = document.createElement("select");
    xScaleSelect.id = nextControlId("x-scale");
    ["linear", "log"].forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = mode;
      xScaleSelect.appendChild(option);
    });
    axesSection.appendChild(createField("X scale", xScaleSelect));

    const yScaleSelect = document.createElement("select");
    yScaleSelect.id = nextControlId("y-scale");
    ["linear", "log"].forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = mode;
      yScaleSelect.appendChild(option);
    });
    axesSection.appendChild(createField("Y scale", yScaleSelect));

    const xRangeModeSelect = document.createElement("select");
    xRangeModeSelect.id = nextControlId("x-range-mode");
    ["auto", "manual"].forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = mode;
      xRangeModeSelect.appendChild(option);
    });
    axesSection.appendChild(createField("X range", xRangeModeSelect));

    const xRangeMinInput = document.createElement("input");
    xRangeMinInput.type = "number";
    xRangeMinInput.step = "any";
    xRangeMinInput.id = nextControlId("x-range-min");
    xRangeMinInput.placeholder = "min";
    axesSection.appendChild(createField("X range min", xRangeMinInput));
    const xRangeMaxInput = document.createElement("input");
    xRangeMaxInput.type = "number";
    xRangeMaxInput.step = "any";
    xRangeMaxInput.id = nextControlId("x-range-max");
    xRangeMaxInput.placeholder = "max";
    axesSection.appendChild(createField("X range max", xRangeMaxInput));

    const yRangeModeSelect = document.createElement("select");
    yRangeModeSelect.id = nextControlId("y-range-mode");
    ["auto", "manual"].forEach((mode) => {
      const option = document.createElement("option");
      option.value = mode;
      option.textContent = mode;
      yRangeModeSelect.appendChild(option);
    });
    axesSection.appendChild(createField("Y range", yRangeModeSelect));

    const yRangeMinInput = document.createElement("input");
    yRangeMinInput.type = "number";
    yRangeMinInput.step = "any";
    yRangeMinInput.id = nextControlId("y-range-min");
    yRangeMinInput.placeholder = "min";
    axesSection.appendChild(createField("Y range min", yRangeMinInput));
    const yRangeMaxInput = document.createElement("input");
    yRangeMaxInput.type = "number";
    yRangeMaxInput.step = "any";
    yRangeMaxInput.id = nextControlId("y-range-max");
    yRangeMaxInput.placeholder = "max";
    axesSection.appendChild(createField("Y range max", yRangeMaxInput));

    const dataSection = createSection("Data sampling");
    const maxPointsInput = document.createElement("input");
    maxPointsInput.type = "number";
    maxPointsInput.min = "1";
    maxPointsInput.step = "1";
    maxPointsInput.id = nextControlId("max-points");
    dataSection.appendChild(
      createField("Max points", maxPointsInput, {
        hint: "Limits points per series for large 1D/2D slices.",
      }),
    );

    const maxRowsInput = document.createElement("input");
    maxRowsInput.type = "number";
    maxRowsInput.min = "1";
    maxRowsInput.step = "1";
    maxRowsInput.id = nextControlId("max-rows");
    dataSection.appendChild(
      createField("Max rows", maxRowsInput, {
        hint: "Limits heatmap rows for large 2D frames.",
      }),
    );

    const maxColsInput = document.createElement("input");
    maxColsInput.type = "number";
    maxColsInput.min = "1";
    maxColsInput.step = "1";
    maxColsInput.id = nextControlId("max-cols");
    dataSection.appendChild(
      createField("Max cols", maxColsInput, {
        hint: "Limits heatmap columns for large 2D frames.",
      }),
    );

    const decimationStepInput = document.createElement("input");
    decimationStepInput.type = "number";
    decimationStepInput.min = "1";
    decimationStepInput.step = "1";
    decimationStepInput.id = nextControlId("decimation-step");
    dataSection.appendChild(
      createField("Decimation step", decimationStepInput, {
        hint: "Samples every Nth point when data is dense.",
      }),
    );

    const aspectRatioSection = createSection("Aspect ratio");
    const aspectRatioSelect = document.createElement("select");
    aspectRatioSelect.id = nextControlId("aspect-ratio");
    [
      { value: "auto", label: "Auto" },
      { value: "1:1", label: "1:1" },
      { value: "4:3", label: "4:3" },
      { value: "3:2", label: "3:2" },
      { value: "16:10", label: "16:10" },
      { value: "16:9", label: "16:9" },
    ].forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      aspectRatioSelect.appendChild(option);
    });
    aspectRatioSection.appendChild(
      createField("Preset", aspectRatioSelect),
    );

    const scaleModeSelect = document.createElement("select");
    scaleModeSelect.id = nextControlId("scale-mode");
    [
      { value: "auto", label: "Auto" },
      { value: "equal", label: "Equal (1:1)" },
      { value: "free", label: "Free" },
    ].forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      scaleModeSelect.appendChild(option);
    });
    aspectRatioSection.appendChild(
      createField("Scale mode", scaleModeSelect, {
        hint: "Auto: smart scaling based on data ratio. Equal: enforce 1:1 axis scaling. Free: fill container.",
      }),
    );

    const gridSection = createSection("Grid & ticks");
    const gridToggle = document.createElement("input");
    gridToggle.type = "checkbox";
    gridToggle.id = nextControlId("grid-toggle");
    const gridField = document.createElement("label");
    gridField.className = "plot-customize-checkbox";
    gridField.appendChild(gridToggle);
    gridField.appendChild(document.createTextNode(" Show grid"));
    gridSection.appendChild(gridField);

    const tickDensitySelect = document.createElement("select");
    tickDensitySelect.id = nextControlId("tick-density");
    [
      { value: "auto", label: "auto" },
      { value: "sparse", label: "sparse" },
      { value: "dense", label: "dense" },
    ].forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      tickDensitySelect.appendChild(option);
    });
    gridSection.appendChild(createField("Tick density", tickDensitySelect));

    const traceSection = createSection("Line & markers");
    const lineColorInput = document.createElement("input");
    lineColorInput.type = "color";
    lineColorInput.id = nextControlId("line-color");
    traceSection.appendChild(createField("Line color", lineColorInput));
    const lineWidthInput = document.createElement("input");
    lineWidthInput.type = "number";
    lineWidthInput.min = "1";
    lineWidthInput.max = "10";
    lineWidthInput.step = "0.5";
    lineWidthInput.id = nextControlId("line-width");
    traceSection.appendChild(createField("Line width", lineWidthInput));
    const lineStyleSelect = document.createElement("select");
    lineStyleSelect.id = nextControlId("line-style");
    ["solid", "dashed", "dotted"].forEach((style) => {
      const option = document.createElement("option");
      option.value = style;
      option.textContent = style;
      lineStyleSelect.appendChild(option);
    });
    traceSection.appendChild(createField("Line style", lineStyleSelect));

    const markerToggle = document.createElement("input");
    markerToggle.type = "checkbox";
    markerToggle.id = nextControlId("marker-toggle");
    const markerToggleLabel = document.createElement("label");
    markerToggleLabel.className = "plot-customize-checkbox";
    markerToggleLabel.appendChild(markerToggle);
    markerToggleLabel.appendChild(document.createTextNode(" Show markers"));
    traceSection.appendChild(markerToggleLabel);

    const markerSizeInput = document.createElement("input");
    markerSizeInput.type = "number";
    markerSizeInput.min = "2";
    markerSizeInput.max = "20";
    markerSizeInput.step = "1";
    markerSizeInput.id = nextControlId("marker-size");
    traceSection.appendChild(createField("Marker size", markerSizeInput));

    const markerShapeSelect = document.createElement("select");
    markerShapeSelect.id = nextControlId("marker-shape");
    [
      { value: "circle", label: "circle" },
      { value: "square", label: "square" },
      { value: "diamond", label: "diamond" },
      { value: "cross", label: "cross" },
      { value: "x", label: "x" },
      { value: "triangle-up", label: "triangle-up" },
      { value: "triangle-down", label: "triangle-down" },
    ].forEach(({ value, label }) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = label;
      markerShapeSelect.appendChild(option);
    });
    traceSection.appendChild(createField("Marker shape", markerShapeSelect));

    const legendSection = createSection("Legend & naming");
    const traceNameInput = document.createElement("input");
    traceNameInput.type = "text";
    traceNameInput.id = nextControlId("trace-name");
    traceNameInput.placeholder = "Trace label";
    legendSection.appendChild(createField("Trace name", traceNameInput));
    const legendToggle = document.createElement("input");
    legendToggle.type = "checkbox";
    legendToggle.id = nextControlId("legend-toggle");
    const legendLabel = document.createElement("label");
    legendLabel.className = "plot-customize-checkbox";
    legendLabel.appendChild(legendToggle);
    legendLabel.appendChild(document.createTextNode(" Show legend"));
    legendSection.appendChild(legendLabel);

    const interactionSection = createSection("Interaction");
    const hoverToggle = document.createElement("input");
    hoverToggle.type = "checkbox";
    hoverToggle.id = nextControlId("hover-toggle");
    const hoverLabel = document.createElement("label");
    hoverLabel.className = "plot-customize-checkbox";
    hoverLabel.appendChild(hoverToggle);
    hoverLabel.appendChild(document.createTextNode(" Enable hover tooltips"));
    interactionSection.appendChild(hoverLabel);

    customizeBody.appendChild(labelsSection);
    customizeBody.appendChild(axesSection);
    customizeBody.appendChild(dataSection);
    customizeBody.appendChild(aspectRatioSection);
    customizeBody.appendChild(gridSection);
    customizeBody.appendChild(traceSection);
    customizeBody.appendChild(legendSection);
    customizeBody.appendChild(interactionSection);

    customizePanel.appendChild(customizeHeader);
    customizePanel.appendChild(customizeBody);

    const dashboardOverlay = document.createElement("div");
    dashboardOverlay.className = "plot-dashboard-overlay";
    dashboardOverlay.hidden = true;

    const dashboardPanel = document.createElement("aside");
    dashboardPanel.className = "plot-dashboard-panel";
    dashboardPanel.hidden = true;
    dashboardPanel.setAttribute("aria-hidden", "true");
    const dashboardPanelId = nextControlId("dashboard-panel");
    dashboardPanel.id = dashboardPanelId;
    addToDashboardButton.setAttribute("aria-controls", dashboardPanelId);
    addToDashboardButton.setAttribute("aria-expanded", "false");

    const dashboardHeader = document.createElement("div");
    dashboardHeader.className = "plot-dashboard-header";
    const dashboardTitle = document.createElement("h3");
    dashboardTitle.textContent = "Add plot to dashboard";
    const dashboardClose = document.createElement("button");
    dashboardClose.type = "button";
    dashboardClose.className = "plot-dashboard-close";
    dashboardClose.setAttribute("aria-label", "Close");
    dashboardClose.title = "Close";
    dashboardClose.innerHTML = icons.x;
    dashboardHeader.appendChild(dashboardTitle);
    dashboardHeader.appendChild(dashboardClose);

    const dashboardBody = document.createElement("div");
    dashboardBody.className = "plot-dashboard-body";
    const dashboardNote = document.createElement("p");
    dashboardNote.className = "plot-dashboard-note muted";
    const dashboardList = document.createElement("div");
    dashboardList.className = "plot-dashboard-list";

    const dashboardCreateButton = document.createElement("button");
    dashboardCreateButton.type = "button";
    dashboardCreateButton.className = "button button-secondary";
    dashboardCreateButton.textContent = "Create new dashboard";

    dashboardBody.appendChild(dashboardNote);
    dashboardBody.appendChild(dashboardList);

    dashboardPanel.appendChild(dashboardHeader);
    dashboardPanel.appendChild(dashboardBody);

    controls.insertBefore(sliceControls, customizeEntry);
    plotControlsSlot.appendChild(controls);
    container.appendChild(status);
    container.appendChild(plotArea);
    container.appendChild(customizeOverlay);
    container.appendChild(customizePanel);
    container.appendChild(dashboardOverlay);
    container.appendChild(dashboardPanel);
    plotPanel.appendChild(container);

    return {
      container,
      controls,
      fileSelector,
      tabbedSelector,
      customizeButton,
      customizeOverlay,
      customizePanel,
      resetButton,
      addToDashboardButton,
      dashboardOverlay,
      dashboardPanel,
      dashboardClose,
      dashboardNote,
      dashboardList,
      dashboardCreateButton,
      titleInput,
      xAxisLabelInput,
      yAxisLabelInput,
      sliderLabelInput,
      colorbarLabelInput,
      xScaleSelect,
      yScaleSelect,
      xRangeModeSelect,
      xRangeMinInput,
      xRangeMaxInput,
      yRangeModeSelect,
      yRangeMinInput,
      yRangeMaxInput,
      maxPointsInput,
      maxRowsInput,
      maxColsInput,
      decimationStepInput,
      aspectRatioSelect,
      scaleModeSelect,
      gridToggle,
      tickDensitySelect,
      lineColorInput,
      lineWidthInput,
      lineStyleSelect,
      markerToggle,
      markerSizeInput,
      markerShapeSelect,
      traceNameInput,
      legendToggle,
      hoverToggle,
      note,
      error,
      sliceControls,
      sliceLabel,
      sliceRange,
      sliceNumber,
      sliceLabelText,
      allSeriesButton,
      plotArea,
      plotCanvas,
      placeholder,
    };
  })();

  function setCustomizeOpen(isOpen) {
    if (!isOpen && plotElements.customizePanel.contains(document.activeElement)) {
      plotElements.customizeButton.focus();
    }
    plotElements.customizeOverlay.hidden = !isOpen;
    plotElements.customizePanel.hidden = !isOpen;
    plotElements.customizePanel.setAttribute(
      "aria-hidden",
      String(!isOpen),
    );
    plotElements.customizeButton.setAttribute(
      "aria-expanded",
      String(isOpen),
    );
    plotElements.customizeButton.innerHTML = isOpen ? icons.x : icons.settings;
    plotElements.customizeButton.title = isOpen ? "Close" : "Customize";
    plotElements.customizePanel.classList.toggle("is-open", isOpen);
    plotElements.customizeOverlay.classList.toggle("is-open", isOpen);
  }

  function closePlotPanels() {
    setCustomizeOpen(false);
    setDashboardPickerOpen(false);
  }

  function setDashboardPickerOpen(isOpen) {
    if (!isOpen && plotElements.dashboardPanel.contains(document.activeElement)) {
      plotElements.addToDashboardButton.focus();
    }
    plotElements.dashboardOverlay.hidden = !isOpen;
    plotElements.dashboardPanel.hidden = !isOpen;
    plotElements.dashboardPanel.setAttribute("aria-hidden", String(!isOpen));
    plotElements.addToDashboardButton.setAttribute(
      "aria-expanded",
      String(isOpen),
    );
    plotElements.dashboardPanel.classList.toggle("is-open", isOpen);
    plotElements.dashboardOverlay.classList.toggle("is-open", isOpen);
  }

  function closeDashboardPicker() {
    setDashboardPickerOpen(false);
  }

  function getPlotConfigSnapshot() {
    const xPath =
      plotSelection.xPath === "__index__" ? "" : plotSelection.xPath;
    const resolvedFileLabel = plotFileKey
      ? getPlotFileOptionByKey(plotFileKey)?.fileLabel ||
        (!isOpfsEncodedName(plotFileLabel) ? plotFileLabel : "") ||
        "Unnamed file"
      : "";
    return {
      fileKey: plotFileKey,
      fileLabel: resolvedFileLabel,
      xPath,
      yPath: plotSelection.yPath,
      yAxisPath: plotSelection.yAxisPath,
      slicePath: plotSelection.slicePath,
      colorbarPath: plotSelection.colorbarPath,
      yMode: plotSelection.yMode,
      sliceIndex: plotSelection.sliceIndex,
      sliceAxis: plotSelection.sliceAxis,
      showAllSeries: plotSelection.showAllSeries,
      plotSettings: structuredClone(plotSettings ?? {}),
      plotOverrides: plotOverrides ? structuredClone(plotOverrides) : null,
    };
  }

  function notifyPlotConfigChange() {
    if (!plotSyncTarget) {
      return;
    }
    onPlotConfigChange?.(plotSyncTarget, getPlotConfigSnapshot());
  }

  function resolveAxisLabel(path, fallback) {
    return path ? path : fallback;
  }

  function resolveAxisLabelsForSpec() {
    const resolvedColorbarLabel = plotSettings.colorbarLabel?.trim();
    return {
      xLabel: resolveAxisLabel(
        plotSelection.xPath === "__index__" || !plotSelection.xPath
          ? "Index"
          : plotSelection.xPath,
        "X",
      ),
      yLabel: resolveAxisLabel(plotSelection.yPath, "Y"),
      zLabel: resolveAxisLabel(
        resolvedColorbarLabel || plotSelection.colorbarPath || plotSelection.yPath,
        "Value",
      ),
    };
  }

  function updateRangeInputState() {
    const xManual = plotSettings.xRangeMode === "manual";
    plotElements.xRangeMinInput.disabled = !xManual;
    plotElements.xRangeMaxInput.disabled = !xManual;
    const yManual = plotSettings.yRangeMode === "manual";
    plotElements.yRangeMinInput.disabled = !yManual;
    plotElements.yRangeMaxInput.disabled = !yManual;
  }

  function updateMarkerInputState() {
    const enabled = plotSettings.showMarkers;
    plotElements.markerSizeInput.disabled = !enabled;
    plotElements.markerShapeSelect.disabled = !enabled;
  }

  function syncPlotSettingsInputs() {
    plotElements.titleInput.value = plotSettings.title ?? "";
    plotElements.xAxisLabelInput.value = plotSettings.xAxisLabel ?? "";
    plotElements.yAxisLabelInput.value = plotSettings.yAxisLabel ?? "";
    plotElements.sliderLabelInput.value = plotSettings.sliderLabel ?? "";
    plotElements.colorbarLabelInput.value = plotSettings.colorbarLabel ?? "";
    plotElements.xScaleSelect.value = plotSettings.xScale ?? "linear";
    plotElements.yScaleSelect.value = plotSettings.yScale ?? "linear";
    plotElements.xRangeModeSelect.value = plotSettings.xRangeMode ?? "auto";
    plotElements.xRangeMinInput.value = plotSettings.xRangeMin ?? "";
    plotElements.xRangeMaxInput.value = plotSettings.xRangeMax ?? "";
    plotElements.yRangeModeSelect.value = plotSettings.yRangeMode ?? "auto";
    plotElements.yRangeMinInput.value = plotSettings.yRangeMin ?? "";
    plotElements.yRangeMaxInput.value = plotSettings.yRangeMax ?? "";
    plotElements.maxPointsInput.value = String(plotSettings.maxPoints ?? 1);
    plotElements.maxRowsInput.value = String(plotSettings.maxRows ?? 1);
    plotElements.maxColsInput.value = String(plotSettings.maxCols ?? 1);
    plotElements.decimationStepInput.value = String(
      plotSettings.decimationStep ?? 1,
    );
    plotElements.aspectRatioSelect.value = plotSettings.aspectRatio ?? "16:10";
    plotElements.scaleModeSelect.value = plotSettings.scaleMode ?? "auto";
    plotElements.gridToggle.checked = Boolean(plotSettings.showGrid);
    plotElements.tickDensitySelect.value = plotSettings.tickDensity ?? "auto";
    plotElements.lineColorInput.value = plotSettings.lineColor ?? "#2d3870";
    plotElements.lineWidthInput.value = String(plotSettings.lineWidth ?? 2);
    plotElements.lineStyleSelect.value = plotSettings.lineStyle ?? "solid";
    plotElements.markerToggle.checked = Boolean(plotSettings.showMarkers);
    plotElements.markerSizeInput.value = String(plotSettings.markerSize ?? 6);
    plotElements.markerShapeSelect.value = plotSettings.markerShape ?? "circle";
    plotElements.traceNameInput.value = plotSettings.traceName ?? "";
    plotElements.legendToggle.checked = Boolean(plotSettings.showLegend);
    plotElements.hoverToggle.checked = Boolean(plotSettings.hoverEnabled);
    updateRangeInputState();
    updateMarkerInputState();
  }

  function updatePlotSettings(nextSettings) {
    plotSettings = { ...plotSettings, ...nextSettings };
    syncPlotSettingsInputs();
    updatePlotSliceControlsForSelection();
    notifyPlotConfigChange();
    triggerPlotRequest();
  }

  function inferTickDensity(value) {
    if (typeof value !== "number" || Number.isNaN(value)) {
      return null;
    }
    if (value <= 6) {
      return "sparse";
    }
    if (value >= 12) {
      return "dense";
    }
    return "auto";
  }

  function clearSliceControls() {
    hasSliceControls = false;
    sliceControls.hidden = true;
    clearElement(sliceControls);
  }

  function applyDatasetFilter(filterText) {
    const term = filterText.trim().toLowerCase();
    if (!term) {
      return plotDatasets;
    }
    return plotDatasets.filter((dataset) =>
      dataset.path.toLowerCase().includes(term),
    );
  }

  function updateSelectorOptions(selector, datasets, includeIndex) {
    clearElement(selector.datalist);
    selector.optionLabels.clear();
    if (includeIndex) {
      const option = document.createElement("option");
      option.value = "Auto index (0…N-1)";
      selector.datalist.appendChild(option);
      selector.optionLabels.set(option.value, "__index__");
    }

    datasets.forEach((dataset) => {
      const label = formatDatasetPath(dataset);
      const option = document.createElement("option");
      option.value = label;
      selector.datalist.appendChild(option);
      selector.optionLabels.set(label, dataset.path);
    });
  }

  function updateSelectorPrefix(selector, dataset, { isAutoIndex = false } = {}) {
    if (!selector.prefix) {
      return;
    }
    const baseLabel = selector.baseLabel ?? "";
    if (isAutoIndex) {
      selector.prefix.textContent = `${baseLabel}:`;
      return;
    }
    const detail = formatDatasetDetail(dataset);
    selector.prefix.textContent = detail
      ? `${baseLabel} [${detail}]:`
      : `${baseLabel}:`;
  }

  function syncSelectorSelections() {
    const xDataset = findDatasetByPath(plotSelection.xPath);
    const yDataset = findDatasetByPath(plotSelection.yPath);
    const sliceDataset = findDatasetByPath(plotSelection.slicePath);
    const colorbarDataset = findDatasetByPath(plotSelection.colorbarPath);
    const isAutoIndex = plotSelection.xPath === "__index__";
    const yRank = yDataset?.shape?.length ?? 0;
    const isHeatmapMode = plotSelection.yMode === "heatmap";
    const yAxisDataset = isHeatmapMode ? findDatasetByPath(plotSelection.yAxisPath) : null;
    const xLabel = isAutoIndex
      ? "Auto index (0…N-1)"
      : plotSelection.xPath
        ? xDataset
          ? formatDatasetLabel(xDataset)
          : plotSelection.xPath
        : "";
    const yLabel = isHeatmapMode
      ? plotSelection.yAxisPath
        ? yAxisDataset
          ? formatDatasetLabel(yAxisDataset)
          : plotSelection.yAxisPath
        : ""
      : plotSelection.yPath
        ? yDataset
          ? yRank >= 2
            ? formatYDatasetLabel(
                yDataset,
                plotSelection.sliceAxis,
                findAxisDatasetForIndex(
                  yDataset.parentPath,
                  plotSelection.sliceAxis,
                  yDataset.shape?.[plotSelection.sliceAxis],
                )?.name ?? null,
              )
            : formatDatasetLabel(yDataset)
          : plotSelection.yPath
        : "";
    const sliceLabel = plotSelection.slicePath
      ? sliceDataset
        ? formatDatasetLabel(sliceDataset)
        : plotSelection.slicePath
      : "";
    const colorbarLabel = plotSelection.colorbarPath
      ? colorbarDataset
        ? formatDatasetLabel(colorbarDataset)
        : plotSelection.colorbarPath
      : "";

    // Update tabbed selector
    const { tabbedSelector } = plotElements;
    tabbedSelector.roleSelections.x = { path: plotSelection.xPath, shape: xDataset?.shape || null };
    tabbedSelector.roleSelections.y = isHeatmapMode
      ? { path: plotSelection.yAxisPath, shape: yAxisDataset?.shape || null }
      : { path: plotSelection.yPath, shape: yDataset?.shape || null };
    tabbedSelector.roleSelections.slider = { path: plotSelection.slicePath, shape: sliceDataset?.shape || null };
    tabbedSelector.roleSelections.colorbar = { path: plotSelection.colorbarPath, shape: colorbarDataset?.shape || null };

    // Update input value based on active role
    const activeRole = tabbedSelector.activeRole;
    switch (activeRole) {
      case "x":
        tabbedSelector.input.value = xLabel ?? "";
        break;
      case "y":
        tabbedSelector.input.value = yLabel ?? "";
        break;
      case "slider":
        tabbedSelector.input.value = sliceLabel ?? "";
        break;
      case "colorbar":
        tabbedSelector.input.value = colorbarLabel ?? "";
        break;
    }

    // Ensure tab labels show plain axis names
    updateTabLabels(tabbedSelector);
  }

  function updateTabLabels(tabbedSelector) {
    tabbedSelector.tabs.x.innerHTML = icons.axisX;
    tabbedSelector.tabs.y.innerHTML = icons.axisY;
    tabbedSelector.tabs.slider.innerHTML = icons.adjustmentsHorizontal;
    tabbedSelector.tabs.colorbar.innerHTML = icons.palette;
  }

  function getPlotFileOptionByKey(fileKey) {
    return plotFileOptions.find((entry) => entry.fileKey === fileKey);
  }

  function updateFileSelectorOptions() {
    clearElement(plotElements.fileSelector.datalist);
    plotElements.fileSelector.optionLabels.clear();

    plotFileOptions.forEach((entry) => {
      const label = entry.fileLabel || entry.fileKey || "Unknown file";
      const option = document.createElement("option");
      option.value = label;
      plotElements.fileSelector.datalist.appendChild(option);
      plotElements.fileSelector.optionLabels.set(label, entry.fileKey);
    });

    plotElements.fileSelector.selectorInput.disabled = !plotFileOptions.length;
  }

  function syncFileSelectorSelection() {
    if (!plotFileKey) {
      plotElements.fileSelector.selectorInput.value = "";
      return;
    }
    const entry = getPlotFileOptionByKey(plotFileKey);
    plotFileLabel = entry?.fileLabel ?? plotFileLabel ?? "";
    plotElements.fileSelector.selectorInput.value =
      entry?.fileLabel || plotFileLabel || plotFileKey;
  }

  function refreshPlotFileOptions() {
    plotFileOptions = getPlotFiles ? getPlotFiles() : [];
    updateFileSelectorOptions();
    if (plotFileKey && !getPlotFileOptionByKey(plotFileKey)) {
      plotFileKey = null;
      plotFileLabel = "";
    }
    if (!plotFileKey) {
      plotFileKey = getCurrentFileKey?.() ?? null;
    }
    syncFileSelectorSelection();
  }

  function updatePlotSelectors({ syncSelection = true } = {}) {
    const filteredX = applyDatasetFilter(plotFilters.x);
    const filteredY = applyDatasetFilter(plotFilters.y);
    const filteredSlice = applyDatasetFilter(plotFilters.slice);
    const filteredColorbar = applyDatasetFilter(plotFilters.colorbar);

    // Update tabbed selector options with all datasets
    updateTabbedSelectorOptions(filteredX, filteredY, filteredSlice, filteredColorbar);

    if (syncSelection) {
      syncSelectorSelections();
    }
    updatePlotSelectorVisibility({ syncSelection });
  }

  function updateTabbedSelectorOptions(filteredX, filteredY, filteredSlice, filteredColorbar) {
    const { tabbedSelector } = plotElements;
    clearElement(tabbedSelector.datalist);
    tabbedSelector.optionLabels.clear();

    // Collect all unique datasets based on active role
    const allDatasets = new Set();
    const addDatasets = (datasets) => {
      datasets.forEach(dataset => allDatasets.add(dataset));
    };

    // Add datasets from all filters
    addDatasets(filteredX);
    addDatasets(filteredY);
    addDatasets(filteredSlice);
    addDatasets(filteredColorbar);

    // Add index option for X role
    if (tabbedSelector.activeRole === "x") {
      const option = document.createElement("option");
      option.value = "Auto index (0…N-1)";
      tabbedSelector.datalist.appendChild(option);
      tabbedSelector.optionLabels.set(option.value, "__index__");
    }

    // Add all dataset options
    Array.from(allDatasets).forEach((dataset) => {
      const label = formatDatasetPath(dataset);
      const option = document.createElement("option");
      option.value = label;
      tabbedSelector.datalist.appendChild(option);
      tabbedSelector.optionLabels.set(label, dataset.path);
    });
  }

  function resolveTabbedSelectorValue(value) {
    if (!value) {
      return "";
    }
    const { tabbedSelector } = plotElements;
    if (tabbedSelector.optionLabels.has(value)) {
      return tabbedSelector.optionLabels.get(value);
    }
    const dataset = findDatasetByPath(value);
    if (dataset) {
      return dataset.path;
    }
    const match = plotDatasets.find(
      (entry) => formatDatasetPath(entry) === value,
    );
    return match ? match.path : "";
  }

  function resolveSelectorValue(selector, value) {
    if (!value) {
      return "";
    }
    if (selector.optionLabels.has(value)) {
      return selector.optionLabels.get(value);
    }
    const dataset = findDatasetByPath(value);
    if (dataset) {
      return dataset.path;
    }
    const match = plotDatasets.find(
      (entry) => formatDatasetPath(entry) === value,
    );
    if (match) {
      return match.path;
    }
    return "";
  }

  function resolveFileSelectorValue(selector, value) {
    if (!value) {
      return "";
    }
    if (selector.optionLabels.has(value)) {
      return selector.optionLabels.get(value);
    }
    const match = plotFileOptions.find(
      (entry) =>
        entry.fileKey === value || entry.fileLabel === value,
    );
    if (match) {
      return match.fileKey;
    }
    return "";
  }

  function updateSelectorInputForPath(selector, path) {
    if (!path) {
      selector.selectorInput.value = "";
      updateSelectorPrefix(selector, null);
      return;
    }
    const dataset = findDatasetByPath(path);
    const isAutoIndex = path === "__index__";
    const label =
      isAutoIndex
        ? "Auto index (0…N-1)"
        : dataset
          ? formatDatasetPath(dataset)
          : path;
    selector.selectorInput.value = label ?? "";
    updateSelectorPrefix(selector, dataset, { isAutoIndex });
  }

  function updatePlotModeForSelection() {
    if (!plotSelection.yPath) {
      plotSelection.yMode = "1d";
      plotSelection.sliceIndex = 0;
      plotSelection.sliceAxis = 0;
      hidePlotSliceControls();
      updatePlotSelectorVisibility({ syncSelection: true });
      return;
    }

    const dataset = findDatasetByPath(plotSelection.yPath);
    if (isNumeric2D(dataset)) {
      plotSelection.yMode = "2d";
      updatePlotSliceAxisForSelection();
      const defaultsApplied = applyDefaultPlotSelections(dataset);
      updatePlotSelectorVisibility({ syncSelection: true });
      if (defaultsApplied) {
        updatePlotSliceControlsForSelection();
      }
      return;
    }

    plotSelection.yMode = "1d";
    plotSelection.sliceIndex = 0;
    plotSelection.sliceAxis = 0;
    hidePlotSliceControls();
    updatePlotSelectorVisibility({ syncSelection: true });
  }

  function findDatasetByPath(path) {
    return plotDatasets.find((dataset) => dataset.path === path);
  }

  function isPreferredXAxisName(name) {
    const normalized = normalizeAxisName(name);
    return normalized === "dim0" || normalized === "time";
  }

  function findSiblingNumericDatasets(dataset) {
    return plotDatasets.filter(
      (entry) =>
        entry.parentPath === dataset.parentPath &&
        entry.path !== dataset.path &&
        isNumeric1D(entry),
    );
  }

  function findSingleNumericSibling(dataset, length) {
    const siblings = findSiblingNumericDatasets(dataset).filter((entry) => {
      if (length === undefined || length === null) {
        return true;
      }
      return (entry.shape?.[0] ?? 0) === length;
    });
    return siblings.length === 1 ? siblings[0] : null;
  }

  function findAxisDatasetByName(parentPath, targetName, length) {
    return plotDatasets.find((dataset) => {
      if (dataset.parentPath !== parentPath || !isNumeric1D(dataset)) {
        return false;
      }
      if (length !== undefined && (dataset.shape?.[0] ?? 0) !== length) {
        return false;
      }
      return normalizeAxisName(dataset.name) === targetName;
    });
  }

  function findAxisDatasetForIndex(parentPath, axisIndex, length) {
    if (!parentPath || !Number.isInteger(axisIndex)) {
      return null;
    }
    const axisLength = length ?? 0;
    if (axisIndex === 0) {
      const timeAxis = findAxisDatasetByName(parentPath, "time", axisLength);
      if (timeAxis) {
        return timeAxis;
      }
    }
    return findAxisDatasetByName(parentPath, `dim${axisIndex}`, axisLength);
  }

  function applyDefaultPlotSelections(yDataset) {
    if (!yDataset || !Array.isArray(yDataset.shape)) {
      return false;
    }
    let updated = false;
    if (
      (plotSelection.yMode === "2d" || plotSelection.yMode === "heatmap") &&
      !plotSelection.slicePath
    ) {
      const axisIndex = Number.isInteger(plotSelection.sliceAxis)
        ? plotSelection.sliceAxis
        : 0;
      const axisLength = yDataset.shape?.[axisIndex];
      const axisDataset = findAxisDatasetForIndex(
        yDataset.parentPath,
        axisIndex,
        axisLength,
      );
      if (axisDataset) {
        plotSelection.slicePath = axisDataset.path;
        updated = true;
      }
    }
    if (
      plotSelection.yMode === "heatmap" &&
      !plotSelection.colorbarPath &&
      yDataset.path
    ) {
      plotSelection.colorbarPath = yDataset.path;
      updated = true;
    }
    return updated;
  }

  function setPlotPlaceholder(message) {
    plotElements.placeholder.textContent = message;
    plotElements.placeholder.hidden = !message;
  }

  function clampSliceIndex(value, max) {
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed)) {
      return 0;
    }
    return Math.min(Math.max(parsed, 0), Math.max(max, 0));
  }

  function hidePlotSliceControls() {
    plotSelection.showAllSeries = false;
    plotElements.sliceControls.hidden = true;
    plotElements.sliceRange.disabled = true;
    plotElements.sliceNumber.disabled = true;
    plotElements.sliceLabel.hidden = false;
    plotElements.sliceLabelText.hidden = true;
    plotElements.allSeriesButton.hidden = true;
    plotElements.allSeriesButton.classList.remove("is-active");
  }

  function updatePlotSelectorVisibility({ syncSelection = true } = {}) {
    const yDataset = findDatasetByPath(plotSelection.yPath);
    const isHeatmap = plotSelection.yMode === "heatmap";
    const is2d = plotSelection.yMode === "2d";
    const showSliceSelector =
      Boolean(plotSelection.yPath) &&
      (is2d || (isHeatmap && (yDataset?.shape?.length ?? 0) >= 3));
    const showColorbarSelector = Boolean(plotSelection.yPath) && isHeatmap;

    // Hide/show tabs instead of wrapper elements
    const { tabbedSelector } = plotElements;
    tabbedSelector.tabs.slider.hidden = !showSliceSelector;
    tabbedSelector.tabs.colorbar.hidden = !showColorbarSelector;

    // If the active tab is now hidden, switch to Y tab
    if ((tabbedSelector.activeRole === "slider" && !showSliceSelector) ||
        (tabbedSelector.activeRole === "colorbar" && !showColorbarSelector)) {
      switchToTab(tabbedSelector, "y");
    }
  }

  function switchToTab(tabbedSelector, roleId) {
    tabbedSelector.activeRole = roleId;

    // Update tab states
    Object.entries(tabbedSelector.tabs).forEach(([role, tab]) => {
      const isActive = role === roleId;
      tab.setAttribute("aria-selected", isActive ? "true" : "false");
      if (isActive) {
        tab.classList.add("active");
      } else {
        tab.classList.remove("active");
      }
    });

    // Update input to show current selection for this role
    const selection = tabbedSelector.roleSelections[roleId];
    if (selection.path) {
      const dataset = findDatasetByPath(selection.path);
      const isAutoIndex = selection.path === "__index__";
      const isHeatmapY = roleId === "y" && plotSelection.yMode === "heatmap";
      const yDataset = findDatasetByPath(plotSelection.yPath);
      const yRank = yDataset?.shape?.length ?? 0;
      const label = isAutoIndex
        ? "Auto index (0…N-1)"
        : dataset
          ? (roleId === "y" && !isHeatmapY && yRank >= 2
              ? formatYDatasetLabel(
                  dataset,
                  plotSelection.sliceAxis,
                  findAxisDatasetForIndex(
                    dataset.parentPath,
                    plotSelection.sliceAxis,
                    dataset.shape?.[plotSelection.sliceAxis],
                  )?.name ?? null,
                )
              : formatDatasetLabel(dataset))
          : selection.path;
      tabbedSelector.input.value = label ?? "";
    } else {
      tabbedSelector.input.value = "";
    }

    // Update datalist options based on active role
    updatePlotSelectors({ syncSelection: false });
  }

  function updatePlotSliceControls(shape, sliceAxis = 0, label = "Slice") {
    const axis = Number.isInteger(sliceAxis) ? sliceAxis : 0;
    const maxIndex = Math.max((shape?.[axis] ?? 1) - 1, 0);
    const nextIndex = clampSliceIndex(plotSelection.sliceIndex, maxIndex);
    plotSelection.sliceIndex = nextIndex;
    plotSelection.sliceAxis = axis;

    plotElements.sliceRange.max = String(maxIndex);
    plotElements.sliceNumber.max = String(maxIndex);
    plotElements.sliceRange.value = String(nextIndex);
    plotElements.sliceNumber.value = String(nextIndex);
    plotElements.sliceRange.disabled = maxIndex <= 0;
    plotElements.sliceNumber.disabled = maxIndex <= 0;
    plotElements.sliceControls.hidden = false;
    updateAllSeriesButtonState(shape);
  }

  function updateAllSeriesButtonState(shape) {
    const is2d = plotSelection.yMode === "2d";
    plotElements.allSeriesButton.hidden = !is2d;
    if (!is2d) {
      plotElements.sliceLabel.hidden = false;
      plotElements.sliceLabelText.hidden = true;
      return;
    }
    const axis = Number.isInteger(plotSelection.sliceAxis) ? plotSelection.sliceAxis : 0;
    const sliceCount = shape?.[axis] ?? 0;
    if (plotSelection.showAllSeries) {
      plotElements.sliceLabel.hidden = true;
      plotElements.sliceLabelText.hidden = false;
      plotElements.sliceLabelText.textContent = `All ${sliceCount} series`;
      plotElements.allSeriesButton.classList.add("is-active");
      plotElements.allSeriesButton.setAttribute("aria-pressed", "true");
    } else {
      plotElements.sliceLabel.hidden = false;
      plotElements.sliceLabelText.hidden = true;
      plotElements.allSeriesButton.classList.remove("is-active");
      plotElements.allSeriesButton.setAttribute("aria-pressed", "false");
    }
  }

  function setPlotSliceAxis(
    shape,
    sliceAxis = 0,
    resetIndex = false,
    label,
  ) {
    if (resetIndex) {
      plotSelection.sliceIndex = 0;
    }
    updatePlotSliceControls(shape, sliceAxis, label);
  }

  function resolve2DSliceAxis(yDataset, xDataset) {
    if (!isNumeric2D(yDataset)) {
      return 0;
    }
    const [rows = 0, cols = 0] = yDataset.shape ?? [];
    if (isNumeric1D(xDataset)) {
      const xLength = xDataset.shape?.[0] ?? 0;
      if (xLength === rows) {
        return 1;
      }
      if (xLength === cols) {
        return 0;
      }
    }
    return 0;
  }

  function resolveSliceAxisFromDataset(yDataset, sliceDataset) {
    if (!sliceDataset || !isNumeric1D(sliceDataset)) {
      return null;
    }
    const sliceLength = sliceDataset.shape?.[0] ?? 0;
    if (isNumeric2D(yDataset)) {
      const [rows = 0, cols = 0] = yDataset.shape ?? [];
      if (sliceLength === rows) {
        return 0;
      }
      if (sliceLength === cols) {
        return 1;
      }
      return null;
    }
    const shape = yDataset?.shape ?? [];
    if (shape.length < 3) {
      return null;
    }
    const leadingDims = shape.slice(0, -2);
    const matchIndex = leadingDims.findIndex(
      (dimension) => dimension === sliceLength,
    );
    return matchIndex >= 0 ? matchIndex : null;
  }

  function getSliceLabelForSelection(yDataset) {
    const sliderLabel = plotSettings.sliderLabel?.trim();
    if (sliderLabel) {
      return sliderLabel;
    }
    const sliceDataset = findDatasetByPath(plotSelection.slicePath);
    if (sliceDataset) {
      return sliceDataset.name ?? sliceDataset.path;
    }
    if (plotSelection.yMode === "heatmap" && (yDataset?.shape?.length ?? 0) >= 3) {
      return "Slice index";
    }
    return "Slice";
  }

  function updatePlotSliceAxisForSelection() {
    const yDataset = findDatasetByPath(plotSelection.yPath);
    if (!isNumeric2D(yDataset)) {
      return;
    }
    const xDataset =
      plotSelection.xPath && plotSelection.xPath !== "__index__"
        ? findDatasetByPath(plotSelection.xPath)
        : null;
    const sliceDataset = findDatasetByPath(plotSelection.slicePath);
    const resolvedAxis =
      resolveSliceAxisFromDataset(yDataset, sliceDataset) ??
      resolve2DSliceAxis(yDataset, xDataset);
    updatePlotSliceControls(
      yDataset.shape,
      resolvedAxis,
      getSliceLabelForSelection(yDataset),
    );
  }

  function triggerPlotRequest({ showLoading = true } = {}) {
    if (!onPlotRequest || activeTab !== "plot") {
      return;
    }

    const xPath =
      plotSelection.xPath === "__index__" ? "" : plotSelection.xPath;
    onPlotRequest({
      fileKey: plotFileKey,
      xPath,
      yPath: plotSelection.yPath,
      yAxisPath: plotSelection.yAxisPath,
      slicePath: plotSelection.slicePath,
      colorbarPath: plotSelection.colorbarPath,
      yMode: plotSelection.yMode,
      sliceIndex: plotSelection.sliceIndex,
      sliceAxis: plotSelection.sliceAxis,
      showAllSeries: plotSelection.showAllSeries,
      plotSettings,
      plotOverrides,
      showLoading,
    });
  }

  function updatePlotSliceControlsForSelection() {
    const dataset = findDatasetByPath(plotSelection.yPath);
    if (!dataset || !Array.isArray(dataset.shape)) {
      hidePlotSliceControls();
      return;
    }
    if (plotSelection.yMode === "2d") {
      const resolvedAxis =
        resolveSliceAxisFromDataset(
          dataset,
          findDatasetByPath(plotSelection.slicePath),
        ) ?? plotSelection.sliceAxis;
      updatePlotSliceControls(
        dataset.shape,
        resolvedAxis,
        getSliceLabelForSelection(dataset),
      );
      return;
    }
    if (plotSelection.yMode === "heatmap" && dataset.shape.length >= 3) {
      const resolvedAxis =
        resolveSliceAxisFromDataset(
          dataset,
          findDatasetByPath(plotSelection.slicePath),
        ) ?? plotSelection.sliceAxis;
      updatePlotSliceControls(
        dataset.shape,
        resolvedAxis,
        getSliceLabelForSelection(dataset),
      );
      return;
    }
    hidePlotSliceControls();
  }

  function updateDatasetMeta(info) {
    if (!info) {
      hasDatasetMeta = false;
      dataMeta.hidden = true;
      clearElement(dataMeta);
      clearSliceControls();
      return;
    }

    hasDatasetMeta = true;
    renderDatasetMetaRow(dataMeta, info);
    dataMeta.hidden = activeTab !== "raw";
    if (activeTab !== "raw") {
      sliceControls.hidden = true;
    }
  }

  function setActiveTab(tab) {
    activeTab = tab;
    viewButtons.forEach((button) => {
      const isActive = button.dataset.view === tab;
      button.setAttribute("aria-selected", String(isActive));
      button.setAttribute("tabindex", isActive ? "0" : "-1");
    });
    document.querySelectorAll(".view-panel").forEach((panel) => {
      panel.hidden = panel.dataset.viewPanel !== tab;
    });
    if (plotControlsSlot) {
      plotControlsSlot.hidden = tab !== "plot";
    }

    if (hasDatasetMeta) {
      dataMeta.hidden = tab !== "raw";
    }

    if (hasSliceControls) {
      sliceControls.hidden = tab !== "raw";
    }

    if (tab === "plot") {
      onPlotTabOpen?.();
      triggerPlotRequest();
    }
  }

  function setTabsEnabled(enabled) {
    const isEnabled = Boolean(enabled);
    viewButtons.forEach((button) => {
      button.disabled = !isEnabled;
      button.setAttribute("aria-disabled", String(!isEnabled));
    });

    if (!isEnabled) {
      setActiveTab("info");
    }
  }

  viewButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setActiveTab(button.dataset.view);
    });
  });

  plotElements.customizeButton.addEventListener("click", () => {
    if (plotElements.customizePanel.classList.contains("is-open")) {
      setCustomizeOpen(false);
    } else {
      closePlotPanels();
      setCustomizeOpen(true);
    }
  });

  plotElements.addToDashboardButton.addEventListener("click", () => {
    closePlotPanels();
    renderDashboardPicker();
    setDashboardPickerOpen(true);
  });

  plotElements.dashboardClose.addEventListener("click", () => {
    closeDashboardPicker();
  });

  plotElements.dashboardOverlay.addEventListener("click", () => {
    closeDashboardPicker();
  });


  plotElements.customizeOverlay.addEventListener("click", () => {
    setCustomizeOpen(false);
  });

  plotElements.resetButton.addEventListener("click", () => {
    plotSettings = structuredClone(initialPlotSettings ?? {});
    plotOverrides = null;
    syncPlotSettingsInputs();
    updatePlotSliceControlsForSelection();
    notifyPlotConfigChange();
    triggerPlotRequest();
  });

  plotElements.titleInput.addEventListener("input", (event) => {
    updatePlotSettings({ title: event.target.value });
  });

  plotElements.xAxisLabelInput.addEventListener("input", (event) => {
    updatePlotSettings({ xAxisLabel: event.target.value });
  });

  plotElements.yAxisLabelInput.addEventListener("input", (event) => {
    updatePlotSettings({ yAxisLabel: event.target.value });
  });

  plotElements.sliderLabelInput.addEventListener("input", (event) => {
    updatePlotSettings({ sliderLabel: event.target.value });
  });

  plotElements.colorbarLabelInput.addEventListener("input", (event) => {
    updatePlotSettings({ colorbarLabel: event.target.value });
  });

  plotElements.xScaleSelect.addEventListener("change", (event) => {
    updatePlotSettings({ xScale: event.target.value });
  });

  plotElements.yScaleSelect.addEventListener("change", (event) => {
    updatePlotSettings({ yScale: event.target.value });
  });

  plotElements.xRangeModeSelect.addEventListener("change", (event) => {
    updatePlotSettings({ xRangeMode: event.target.value });
  });

  plotElements.xRangeMinInput.addEventListener("input", (event) => {
    updatePlotSettings({ xRangeMin: event.target.value });
  });

  plotElements.xRangeMaxInput.addEventListener("input", (event) => {
    updatePlotSettings({ xRangeMax: event.target.value });
  });

  plotElements.yRangeModeSelect.addEventListener("change", (event) => {
    updatePlotSettings({ yRangeMode: event.target.value });
  });

  plotElements.yRangeMinInput.addEventListener("input", (event) => {
    updatePlotSettings({ yRangeMin: event.target.value });
  });

  plotElements.yRangeMaxInput.addEventListener("input", (event) => {
    updatePlotSettings({ yRangeMax: event.target.value });
  });

  plotElements.maxPointsInput.addEventListener("input", (event) => {
    updatePlotSettings({
      maxPoints: parseIntegerValue(event.target.value, plotSettings.maxPoints),
    });
  });

  plotElements.maxRowsInput.addEventListener("input", (event) => {
    updatePlotSettings({
      maxRows: parseIntegerValue(event.target.value, plotSettings.maxRows),
    });
  });

  plotElements.maxColsInput.addEventListener("input", (event) => {
    updatePlotSettings({
      maxCols: parseIntegerValue(event.target.value, plotSettings.maxCols),
    });
  });

  plotElements.decimationStepInput.addEventListener("input", (event) => {
    updatePlotSettings({
      decimationStep: parseIntegerValue(
        event.target.value,
        plotSettings.decimationStep,
      ),
    });
  });

  plotElements.aspectRatioSelect.addEventListener("change", (event) => {
    updatePlotSettings({ aspectRatio: event.target.value });
  });

  plotElements.scaleModeSelect.addEventListener("change", (event) => {
    updatePlotSettings({ scaleMode: event.target.value });
  });

  plotElements.gridToggle.addEventListener("change", (event) => {
    updatePlotSettings({ showGrid: event.target.checked });
  });

  plotElements.tickDensitySelect.addEventListener("change", (event) => {
    updatePlotSettings({ tickDensity: event.target.value });
  });

  plotElements.lineColorInput.addEventListener("input", (event) => {
    updatePlotSettings({ lineColor: event.target.value });
  });

  plotElements.lineWidthInput.addEventListener("input", (event) => {
    updatePlotSettings({
      lineWidth: parseNumberValue(event.target.value, plotSettings.lineWidth),
    });
  });

  plotElements.lineStyleSelect.addEventListener("change", (event) => {
    updatePlotSettings({ lineStyle: event.target.value });
  });

  plotElements.markerToggle.addEventListener("change", (event) => {
    updatePlotSettings({ showMarkers: event.target.checked });
  });

  plotElements.markerSizeInput.addEventListener("input", (event) => {
    updatePlotSettings({
      markerSize: parseNumberValue(
        event.target.value,
        plotSettings.markerSize,
      ),
    });
  });

  plotElements.markerShapeSelect.addEventListener("change", (event) => {
    updatePlotSettings({ markerShape: event.target.value });
  });

  plotElements.traceNameInput.addEventListener("input", (event) => {
    updatePlotSettings({ traceName: event.target.value });
  });

  plotElements.legendToggle.addEventListener("change", (event) => {
    updatePlotSettings({ showLegend: event.target.checked });
  });

  plotElements.hoverToggle.addEventListener("change", (event) => {
    updatePlotSettings({ hoverEnabled: event.target.checked });
  });

  // Tabbed selector - clear on focus so the datalist shows all options;
  // restore the decorated label on blur (change handler commits valid selections).
  plotElements.tabbedSelector.input.addEventListener("focus", () => {
    const activeRole = plotElements.tabbedSelector.activeRole;
    const currentPath = (() => {
      switch (activeRole) {
        case "x": return plotSelection.xPath === "__index__" ? "" : plotSelection.xPath;
        case "y": return plotSelection.yMode === "heatmap" ? plotSelection.yAxisPath : plotSelection.yPath;
        case "slider": return plotSelection.slicePath;
        case "colorbar": return plotSelection.colorbarPath;
        default: return "";
      }
    })();
    const lastSlash = currentPath.lastIndexOf("/");
    const parentPath = lastSlash > 0 ? currentPath.slice(0, lastSlash + 1) : "";
    plotElements.tabbedSelector.input.value = parentPath;
    switch (activeRole) {
      case "x": plotFilters.x = parentPath; break;
      case "y": plotFilters.y = parentPath; break;
      case "slider": plotFilters.slice = parentPath; break;
      case "colorbar": plotFilters.colorbar = parentPath; break;
    }
    updatePlotSelectors({ syncSelection: false });
  });

  plotElements.tabbedSelector.input.addEventListener("blur", () => {
    const activeRole = plotElements.tabbedSelector.activeRole;
    switch (activeRole) {
      case "x": plotFilters.x = ""; break;
      case "y": plotFilters.y = ""; break;
      case "slider": plotFilters.slice = ""; break;
      case "colorbar": plotFilters.colorbar = ""; break;
    }
    syncSelectorSelections();
  });

  // Tabbed selector - input event for filtering
  plotElements.tabbedSelector.input.addEventListener("input", (event) => {
    const nextValue = event.target.value;
    const resolvedValue = resolveTabbedSelectorValue(nextValue);
    const activeRole = plotElements.tabbedSelector.activeRole;

    // Update appropriate filter based on active role
    switch (activeRole) {
      case "x":
        plotFilters.x = resolvedValue || nextValue;
        break;
      case "y":
        plotFilters.y = resolvedValue || nextValue;
        break;
      case "slider":
        plotFilters.slice = resolvedValue || nextValue;
        break;
      case "colorbar":
        plotFilters.colorbar = resolvedValue || nextValue;
        break;
    }

    updatePlotSelectors({ syncSelection: false });
  });

  plotElements.fileSelector.selectorInput.addEventListener("input", (event) => {
    const nextValue = event.target.value;
    const resolvedValue = resolveFileSelectorValue(
      plotElements.fileSelector,
      nextValue,
    );
    plotElements.fileSelector.selectorInput.value = nextValue;
    if (!resolvedValue) {
      return;
    }
    plotFileKey = resolvedValue;
    syncFileSelectorSelection();
  });

  plotElements.fileSelector.selectorInput.addEventListener("change", async (event) => {
    const resolved = resolveFileSelectorValue(plotElements.fileSelector, event.target.value);
    if (!resolved) {
      syncFileSelectorSelection();
      return;
    }
    plotFileKey = resolved;
    const entry = getPlotFileOptionByKey(plotFileKey);
    plotFileLabel = entry?.fileLabel ?? plotFileLabel;
    syncFileSelectorSelection();
    await loadPlotDatasetsForFile(plotFileKey, { resetSelection: true });
    notifyPlotConfigChange();
    triggerPlotRequest();
  });

  // Tab click event listeners
  Object.entries(plotElements.tabbedSelector.tabs).forEach(([roleId, tab]) => {
    tab.addEventListener("click", () => {
      switchToTab(plotElements.tabbedSelector, roleId);
    });
  });

  // Tabbed selector - change event for committing selection
  plotElements.tabbedSelector.input.addEventListener("change", (event) => {
    const resolved = resolveTabbedSelectorValue(event.target.value);
    const activeRole = plotElements.tabbedSelector.activeRole;

    if (!resolved) {
      // Restore previous value if invalid
      syncSelectorSelections();
      return;
    }

    // Update selection based on active role
    switch (activeRole) {
      case "x":
        plotSelection.xPath = resolved;
        if (plotSelection.yMode === "2d") {
          updatePlotSliceAxisForSelection();
        }
        break;
      case "y":
        if (plotSelection.yMode === "heatmap") {
          plotSelection.yAxisPath = resolved;
        } else {
          plotSelection.yPath = resolved;
          updatePlotModeForSelection();
        }
        break;
      case "slider":
        plotSelection.slicePath = resolved;
        updatePlotSliceControlsForSelection();
        break;
      case "colorbar":
        plotSelection.colorbarPath = resolved;
        break;
    }

    // Update roleSelections
    const dataset = findDatasetByPath(resolved);
    plotElements.tabbedSelector.roleSelections[activeRole] = {
      path: resolved,
      shape: dataset?.shape || null
    };

    // Sync the display
    syncSelectorSelections();

    notifyPlotConfigChange();
    triggerPlotRequest();
  });

  plotElements.sliceRange.addEventListener("input", (event) => {
    const maxIndex = Number.parseInt(plotElements.sliceRange.max, 10);
    plotSelection.sliceIndex = clampSliceIndex(event.target.value, maxIndex);
    plotElements.sliceNumber.value = String(plotSelection.sliceIndex);
    notifyPlotConfigChange();
    triggerPlotRequest({ showLoading: false });
  });

  plotElements.sliceNumber.addEventListener("change", (event) => {
    const maxIndex = Number.parseInt(plotElements.sliceNumber.max, 10);
    plotSelection.sliceIndex = clampSliceIndex(event.target.value, maxIndex);
    plotElements.sliceRange.value = String(plotSelection.sliceIndex);
    notifyPlotConfigChange();
    triggerPlotRequest({ showLoading: false });
  });

  plotElements.allSeriesButton.addEventListener("click", () => {
    plotSelection.showAllSeries = !plotSelection.showAllSeries;
    const yDataset = findDatasetByPath(plotSelection.yPath);
    updateAllSeriesButtonState(yDataset?.shape ?? null);
    notifyPlotConfigChange();
    triggerPlotRequest();
  });

  syncPlotSettingsInputs();
  setActiveTab(activeTab);
  refreshPlotFileOptions();

  function showError(message) {
    errorPanel.textContent = message;
    errorPanel.hidden = !message;
  }

  function showPlotError(message) {
    plotElements.error.textContent = message;
    plotElements.error.hidden = !message;
  }

  function showPlotNote(message) {
    plotNoteMessage = message;
    const nextMessage = plotLoadingMessage || plotNoteMessage;
    plotElements.note.textContent = nextMessage;
    plotElements.note.hidden = !nextMessage;
  }

  function showPlotLoading(message) {
    plotLoadingMessage = message;
    const nextMessage = plotLoadingMessage || plotNoteMessage;
    plotElements.note.textContent = nextMessage;
    plotElements.note.hidden = !nextMessage;
  }

  function clearPlotArea() {
    clearElement(plotElements.plotCanvas);
    setPlotPlaceholder("");
  }

  function renderEmptyState(message) {
    renderRawPlaceholder(message);
    renderInfoPlaceholder("Select a dataset or group to view info.");
    updateDatasetMeta(null);
    clearSliceControls();
  }

  function renderLoadingState(message) {
    renderLoadingPlaceholder(message);
    renderInfoPlaceholder("Loading selection details…");
    updateDatasetMeta(null);
    clearSliceControls();
  }

  function clearView() {
    clearElement(rawPanel);
    clearElement(infoPanel);
    updateDatasetMeta(null);
    clearSliceControls();
    clearPlotArea();
    hidePlotSliceControls();
    showPlotError("");
    showPlotNote("");
    showPlotLoading("");
  }

  function renderRawPlaceholder(message) {
    clearElement(rawPanel);
    const placeholder = document.createElement("p");
    placeholder.className = "muted empty-state";
    placeholder.textContent = message;
    rawPanel.appendChild(placeholder);
  }

  function renderLoadingPlaceholder(message) {
    clearElement(rawPanel);
    const container = document.createElement("div");
    container.className = "loading-state";

    const spinner = document.createElement("div");
    spinner.className = "loading-spinner";
    spinner.setAttribute("aria-hidden", "true");

    const text = document.createElement("p");
    text.className = "muted";
    text.textContent = message;

    container.appendChild(spinner);
    container.appendChild(text);
    rawPanel.appendChild(container);
  }

  function renderInfoPlaceholder(message) {
    clearElement(infoPanel);
    const placeholder = document.createElement("p");
    placeholder.className = "muted empty-state";
    placeholder.textContent = message;
    infoPanel.appendChild(placeholder);
  }

  function renderGroup(info, children) {
    clearElement(rawPanel);
    clearElement(infoPanel);
    const groupMeta = renderGroupMeta(info);
    const childrenRow = renderChildrenRow(children);
    if (childrenRow) {
      groupMeta.appendChild(childrenRow);
    }
    infoPanel.appendChild(groupMeta);
    updateDatasetMeta(null);
  }

  function renderDataset(info, preview, sliceConfig) {
    clearElement(rawPanel);
    updateDatasetMeta(info);

    let sliceControlsContent = null;
    if (sliceConfig) {
      hasSliceControls = true;
      sliceControlsContent = renderSliceControls(
        sliceConfig.shape,
        sliceConfig.leadingIndices,
        sliceConfig.onRequest,
      );
      // Hide the separate slice controls container since we're moving them into the table
      clearElement(sliceControls);
      sliceControls.hidden = true;
    } else {
      clearSliceControls();
    }

    rawPanel.appendChild(renderPreview(preview, sliceControlsContent));

    clearElement(infoPanel);
    infoPanel.appendChild(renderDatasetDetails(info));
  }


  function setPlotDatasets(
    datasets,
    { resetSelection = true, fileKey = plotFileKey, fileLabel = "" } = {},
  ) {
    refreshPlotFileOptions();
    plotDatasets = [...datasets].sort((a, b) => a.path.localeCompare(b.path));
    plotFilters = { x: "", y: "", slice: "", colorbar: "" };
    plotSyncTarget = null;
    if (fileKey !== undefined) {
      plotFileKey = fileKey;
      plotFileLabel = fileLabel || plotFileLabel;
    }
    if (resetSelection) {
      plotSelection = {
        xPath: "__index__",
        yPath: "",
        yAxisPath: "",
        slicePath: "",
        colorbarPath: "",
        yMode: "1d",
        sliceIndex: 0,
        sliceAxis: 0,
        showAllSeries: false,
      };
    }

    plotElements.tabbedSelector.input.value = "";
    plotElements.tabbedSelector.roleSelections = {
      y: { path: "", shape: null },
      x: { path: "", shape: null },
      slider: { path: "", shape: null },
      colorbar: { path: "", shape: null }
    };
    syncFileSelectorSelection();
    updatePlotSelectors();
    hidePlotSliceControls();

    const hasDatasets = plotDatasets.length > 0;
    plotElements.tabbedSelector.input.disabled = !hasDatasets;
    if (!hasDatasets) {
      setPlotPlaceholder("Load an HDF5 file to choose datasets.");
      showPlotError("");
      showPlotNote("");
    } else {
      setPlotPlaceholder("");
    }
  }

  function setPlotSelection(selection) {
    if (!selection || selection.type !== "dataset") {
      return;
    }
    const currentFileKey = getCurrentFileKey?.() ?? null;
    if (currentFileKey && plotFileKey !== currentFileKey) {
      plotFileKey = currentFileKey;
      plotFileLabel = "";
      refreshPlotFileOptions();
      loadPlotDatasetsForFile(plotFileKey, { resetSelection: false });
    }

    const dataset = findDatasetByPath(selection.path);
    if (!dataset) {
      return;
    }

    const rank = dataset.shape?.length ?? 0;
    if (rank >= 3) {
      if (!isNumeric3D(dataset)) {
        plotSelection = {
          xPath: "__index__",
          yPath: dataset.path,
          yAxisPath: "",
          slicePath: "",
          colorbarPath: "",
          yMode: "heatmap",
          sliceIndex: 0,
          sliceAxis: 0,
          showAllSeries: false,
        };
        updatePlotSelectors();
        updatePlotSliceControlsForSelection();
        clearPlotArea();
        setPlotPlaceholder("");
        showPlotError("");
        showPlotNote("");
        notifyPlotConfigChange();
        triggerPlotRequest();
        return;
      }

      const timeAxis = findAxisDatasetByName(
        dataset.parentPath,
        "time",
        dataset.shape?.[0] ?? 0,
      );
      const zAxis =
        findAxisDatasetByName(
          dataset.parentPath,
          "z",
          dataset.shape?.[1] ?? 0,
        ) ??
        findAxisDatasetByName(
          dataset.parentPath,
          "dim1",
          dataset.shape?.[1] ?? 0,
        );
      const rAxis =
        findAxisDatasetByName(
          dataset.parentPath,
          "r",
          dataset.shape?.[2] ?? 0,
        ) ??
        findAxisDatasetByName(
          dataset.parentPath,
          "dim2",
          dataset.shape?.[2] ?? 0,
        );

      plotSelection = {
        xPath: rAxis?.path ?? "__index__",
        yPath: dataset.path,
        yAxisPath: zAxis?.path ?? "",
        slicePath: "",
        colorbarPath: "",
        yMode: "heatmap",
        sliceIndex: 0,
        sliceAxis: 0,
        showAllSeries: false,
      };
      applyDefaultPlotSelections(dataset);
      updatePlotSelectors();
      updatePlotSliceControls(
        dataset.shape,
        0,
        timeAxis ? "Time index" : "Slice index",
      );
      clearPlotArea();
      setPlotPlaceholder("");
      showPlotError("");
      showPlotNote(
        zAxis
          ? `Rendering Z vs R at ${timeAxis?.name ?? "time"} slice.`
          : "Rendering a Z–R heatmap at the selected slice.",
      );
      notifyPlotConfigChange();
      triggerPlotRequest();
      return;
    }

    if (rank === 2) {
      if (!isNumeric2D(dataset)) {
        plotSelection = {
          xPath: "__index__",
          yPath: dataset.path,
          yAxisPath: "",
          slicePath: "",
          colorbarPath: "",
          yMode: "2d",
          sliceIndex: 0,
          sliceAxis: 0,
          showAllSeries: false,
        };
        updatePlotSelectors();
        updatePlotSliceControlsForSelection();
        clearPlotArea();
        setPlotPlaceholder("");
        showPlotError("");
        showPlotNote("");
        notifyPlotConfigChange();
        triggerPlotRequest();
        return;
      }

      const columnLength = dataset.shape?.[1] ?? 0;
      const rowLength = dataset.shape?.[0] ?? 0;
      plotSelection.xPath = "__index__";
      plotSelection.yPath = dataset.path;
      plotSelection.yAxisPath = "";
      plotSelection.slicePath = "";
      plotSelection.colorbarPath = "";
      plotSelection.yMode = "2d";
      plotSelection.sliceIndex = 0;
      plotSelection.sliceAxis = 0;
      plotSelection.showAllSeries = false;

      const timeAxisRows = findAxisDatasetByName(
        dataset.parentPath,
        "time",
        rowLength,
      );
      const dimAxisRows =
        timeAxisRows ??
        findAxisDatasetByName(dataset.parentPath, "dim0", rowLength);
      if (dimAxisRows) {
        plotSelection.xPath = dimAxisRows.path;
        plotSelection.sliceAxis = 1;
      } else {
        const timeAxisCols = findAxisDatasetByName(
          dataset.parentPath,
          "time",
          columnLength,
        );
        const dimAxisCols =
          timeAxisCols ??
          findAxisDatasetByName(dataset.parentPath, "dim0", columnLength);
        if (dimAxisCols) {
          plotSelection.xPath = dimAxisCols.path;
          plotSelection.sliceAxis = 0;
        } else {
          const siblingRows = findSingleNumericSibling(dataset, rowLength);
          if (siblingRows) {
            plotSelection.xPath = siblingRows.path;
            plotSelection.sliceAxis = 1;
          } else {
            const siblingCols = findSingleNumericSibling(dataset, columnLength);
            if (siblingCols) {
              plotSelection.xPath = siblingCols.path;
              plotSelection.sliceAxis = 0;
            }
          }
        }
      }

      applyDefaultPlotSelections(dataset);
      updatePlotSelectors();
      updatePlotSliceControls(
        dataset.shape,
        plotSelection.sliceAxis,
        getSliceLabelForSelection(dataset),
      );
      setPlotPlaceholder("");
      showPlotError("");
      showPlotNote("");
      notifyPlotConfigChange();
      triggerPlotRequest();
      return;
    }

    if (!isNumeric1D(dataset)) {
      plotSelection = {
        xPath: "__index__",
        yPath: dataset.path,
        yAxisPath: "",
        slicePath: "",
        colorbarPath: "",
        yMode: "1d",
        sliceIndex: 0,
        sliceAxis: 0,
        showAllSeries: false,
      };
      updatePlotSelectors();
      updatePlotSliceControlsForSelection();
      clearPlotArea();
      setPlotPlaceholder("");
      showPlotError("");
      showPlotNote("");
      notifyPlotConfigChange();
      triggerPlotRequest();
      return;
    }

    plotSelection.xPath = "";
    plotSelection.yPath = "";
    plotSelection.slicePath = "";
    plotSelection.colorbarPath = "";
    plotSelection.yMode = "1d";
    plotSelection.sliceIndex = 0;
    plotSelection.sliceAxis = 0;
    plotSelection.showAllSeries = false;
    hidePlotSliceControls();

    const preferXAxis = isPreferredXAxisName(dataset.name);
    if (preferXAxis) {
      plotSelection.xPath = dataset.path;
      if (plotSelection.yPath === dataset.path) {
        plotSelection.yPath = "";
      }
    } else {
      plotSelection.yPath = dataset.path;
      if (plotSelection.xPath === dataset.path) {
        plotSelection.xPath = "";
      }
    }

    const targetLength = dataset.shape?.[0] ?? 0;
    const sibling = findSingleNumericSibling(dataset, targetLength);
    if (sibling) {
      if (preferXAxis) {
        plotSelection.yPath = sibling.path;
      } else {
        plotSelection.xPath = sibling.path;
      }
    }

    if (!plotSelection.xPath) {
      const timeAxis = findAxisDatasetByName(
        dataset.parentPath,
        "time",
        targetLength,
      );
      const dimAxis =
        timeAxis ??
        findAxisDatasetByName(dataset.parentPath, "dim0", targetLength);
      plotSelection.xPath = dimAxis ? dimAxis.path : "__index__";
    }

    updatePlotSelectors();
    updatePlotModeForSelection();
    setPlotPlaceholder("");
    showPlotError("");
    showPlotNote("");
    if (plotSelection.yPath) {
      notifyPlotConfigChange();
      triggerPlotRequest();
    }
  }

  function resetPlotSettings(nextSettings) {
    plotSettings = structuredClone(nextSettings ?? {});
    plotOverrides = null;
    syncPlotSettingsInputs();
    notifyPlotConfigChange();
    triggerPlotRequest();
  }

  function applyPlotConfig(config) {
    if (!config) {
      return;
    }
    plotFileKey = config.fileKey ?? getCurrentFileKey?.() ?? null;
    plotFileLabel = config.fileLabel ?? plotFileLabel;
    refreshPlotFileOptions();
    plotSettings = structuredClone(
      config.plotSettings ?? initialPlotSettings ?? {},
    );
    plotOverrides = config.plotOverrides
      ? structuredClone(config.plotOverrides)
      : null;
    syncPlotSettingsInputs();
    plotSelection = {
      xPath: config.xPath ? config.xPath : "__index__",
      yPath: config.yPath ?? "",
      yAxisPath: config.yAxisPath ?? "",
      slicePath: config.slicePath ?? "",
      colorbarPath: config.colorbarPath ?? "",
      yMode: config.yMode ?? "1d",
      sliceIndex: config.sliceIndex ?? 0,
      sliceAxis: config.sliceAxis ?? 0,
      showAllSeries: config.showAllSeries ?? false,
    };
    plotFilters = { x: "", y: "", slice: "", colorbar: "" };
    loadPlotDatasetsForFile(plotFileKey, { resetSelection: false });
    updatePlotSelectors();
    updatePlotSliceControlsForSelection();
    setPlotPlaceholder("");
    showPlotError("");
    showPlotNote("");
    notifyPlotConfigChange();
    triggerPlotRequest();
  }

  function setPlotSyncTarget(target) {
    plotSyncTarget = target;
  }

  function clearPlotSyncTarget() {
    plotSyncTarget = null;
  }

  async function loadPlotDatasetsForFile(fileKey, { resetSelection = true } = {}) {
    if (!fileKey) {
      setPlotDatasets([], { resetSelection });
      return;
    }
    try {
      const datasets = await Promise.resolve(getPlotDatasets?.(fileKey));
      setPlotDatasets(datasets ?? [], {
        resetSelection,
        fileKey,
        fileLabel: getPlotFileOptionByKey(fileKey)?.fileLabel ?? plotFileLabel,
      });
    } catch (error) {
      setPlotDatasets([], { resetSelection, fileKey });
      showPlotError(error.message);
    }
  }

  function setAddToDashboardEnabled(enabled) {
    addToDashboardEnabled = Boolean(enabled);
    plotElements.addToDashboardButton.disabled = !addToDashboardEnabled;
  }

  function renderDashboardPicker() {
    clearElement(plotElements.dashboardList);
    const dashboards = getDashboards ? getDashboards() : [];
    const currentFileKey = getCurrentFileKey ? getCurrentFileKey() : null;
    const canAdd = Boolean(currentFileKey) && addToDashboardEnabled;
    const plotConfig = getPlotConfigSnapshot();
    const hasPlot = Boolean(plotConfig.yPath);

    let dashboardNote = "";
    if (!currentFileKey) {
      dashboardNote = "Open an HDF5 file to link this plot to it.";
    } else if (!hasPlot) {
      dashboardNote = "Select a Y dataset to add a plot to a dashboard.";
    }
    plotElements.dashboardNote.textContent = dashboardNote;
    plotElements.dashboardNote.hidden = !dashboardNote;

    dashboards.forEach((dashboard) => {
      const row = document.createElement("div");
      row.className = "plot-dashboard-row";
      const action = document.createElement("button");
      action.type = "button";
      action.className = "button button-secondary plot-dashboard-name";
      action.textContent = dashboard.name;

      if (!canAdd || !hasPlot) {
        row.classList.add("is-disabled");
        action.disabled = true;
      }

      action.addEventListener("click", () => {
        if (!addPlotToDashboard) {
          return;
        }
        addPlotToDashboard(dashboard.id, plotConfig);
        closeDashboardPicker();
        activateDashboard?.(dashboard.id);
      });

      row.appendChild(action);
      plotElements.dashboardList.appendChild(row);
    });

    const createRow = document.createElement("div");
    createRow.className = "plot-dashboard-row plot-dashboard-row--create";
    createRow.appendChild(plotElements.dashboardCreateButton);
    plotElements.dashboardList.appendChild(createRow);

    plotElements.dashboardCreateButton.disabled = !canAdd || !hasPlot;
    plotElements.dashboardCreateButton.onclick = () => {
      if (!createDashboard || !addPlotToDashboard) {
        return;
      }
      const dashboardId = createDashboard();
      if (!dashboardId) {
        return;
      }
      addPlotToDashboard(dashboardId, plotConfig);
      closeDashboardPicker();
      activateDashboard?.(dashboardId);
    };
  }

  return {
    setActiveTab,
    showError,
    showPlotError,
    showPlotNote,
    showPlotLoading,
    renderEmptyState,
    renderLoadingState,
    renderGroup,
    renderDataset,
    clearView,
    setPlotDatasets,
    setPlotSelection,
    resetPlotSettings,
    setTabsEnabled,
    applyPlotConfig,
    setPlotSyncTarget,
    clearPlotSyncTarget,
    setAddToDashboardEnabled,
    refreshPlotFileOptions,
    plotContainer: plotElements.plotCanvas,
    clearPlotArea,
    setPlotPlaceholder,
    setPlotSliceAxis,
    get activeTab() {
      return activeTab;
    },
  };
}
