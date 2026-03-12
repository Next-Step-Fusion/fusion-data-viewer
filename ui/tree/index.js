import { icons } from "../icons.js";

function clearElement(element) {
  while (element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createTreeItem(node, onSelect, onToggle, onOpen, onClose) {
  const item = document.createElement("li");
  item.className = "tree-item";
  item.dataset.path = node.path;
  item.dataset.type = node.type;
  item.dataset.name = node.name.toLowerCase();
  item.dataset.label = node.name;
  if (node.fileKey) {
    item.dataset.fileKey = node.fileKey;
  }
  item.setAttribute("aria-selected", "false");

  const row = document.createElement("div");
  row.className = "tree-row";

  if (node.type === "group") {
    const toggle = document.createElement("button");
    toggle.className = "tree-toggle";
    toggle.type = "button";
    toggle.setAttribute("aria-expanded", "false");
    toggle.innerHTML = icons.chevronRight;
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      onToggle(node, item, toggle);
    });
    row.appendChild(toggle);
  }

  const label = document.createElement("button");
  label.type = "button";
  label.className = `tree-label ${node.type}`;
  if (node.isError) {
    label.innerHTML = icons.alertTriangle;
    label.style.color = "var(--color-error, #ef4444)";
  } else {
    label.innerHTML = node.type === "group" ? icons.folder : icons.table;
  }
  const labelText = document.createElement("span");
  labelText.textContent = node.name;
  label.appendChild(labelText);
  if (!node.isError) {
    if (node.type === "dataset") {
      label.title = "Click to preview · Double-click to plot";
    } else if (node.type === "group") {
      label.title = "Click to preview";
    }
  }
  label.addEventListener("click", () => onSelect(node, item));
  label.addEventListener("dblclick", () => onOpen?.(node, item));
  row.appendChild(label);

  if (node.isFileRoot && (onClose || node.onDismiss)) {
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "file-switcher-close tree-file-close";
    closeButton.setAttribute("aria-label", "Dismiss");
    closeButton.title = node.isError ? "Dismiss" : "Close file";
    closeButton.innerHTML = icons.x;
    closeButton.addEventListener("click", (event) => {
      event.stopPropagation();
      if (node.isError) {
        node.onDismiss?.();
      } else {
        onClose?.(node);
      }
    });
    row.appendChild(closeButton);
  }

  item.appendChild(row);

  if (node.type === "group") {
    const childrenContainer = document.createElement("ul");
    childrenContainer.className = "tree-children";
    childrenContainer.hidden = true;
    item.appendChild(childrenContainer);

    if (Array.isArray(node.children)) {
      renderChildren(
        childrenContainer,
        node.children,
        onSelect,
        onToggle,
        onOpen,
        onClose,
      );
      if (node.expanded) {
        ensureExpanded(item);
      }
    }
  }

  return item;
}

function renderChildren(
  container,
  children,
  onSelect,
  onToggle,
  onOpen,
  onClose,
) {
  clearElement(container);
  if (!children.length) {
    const empty = document.createElement("li");
    empty.className = "tree-empty";
    empty.textContent = "No children";
    container.appendChild(empty);
    return;
  }
  children.forEach((child) => {
    const childItem = createTreeItem(child, onSelect, onToggle, onOpen, onClose);
    container.appendChild(childItem);
  });
}

function renderLoadError(container, message) {
  clearElement(container);
  const errorItem = document.createElement("li");
  errorItem.className = "tree-empty";
  errorItem.textContent = message || "Failed to load children";
  container.appendChild(errorItem);
}

function ensureExpanded(item) {
  const toggle = item.querySelector(":scope > .tree-row .tree-toggle");
  const childrenContainer = item.querySelector(":scope > .tree-children");
  if (!toggle || !childrenContainer) {
    return;
  }
  toggle.setAttribute("aria-expanded", "true");
  toggle.innerHTML = icons.chevronDown;
  childrenContainer.hidden = false;
}

function revealItem(item) {
  item.hidden = false;
  let parentItem = item.parentElement?.closest(".tree-item");
  while (parentItem) {
    parentItem.hidden = false;
    ensureExpanded(parentItem);
    parentItem = parentItem.parentElement?.closest(".tree-item");
  }
}

function collapseDescendants(item) {
  const childrenContainer = item.querySelector(":scope > .tree-children");
  if (!childrenContainer) return;
  for (const descendant of childrenContainer.querySelectorAll(".tree-item")) {
    const descToggle = descendant.querySelector(":scope > .tree-row .tree-toggle");
    const descChildren = descendant.querySelector(":scope > .tree-children");
    if (descToggle && descToggle.getAttribute("aria-expanded") === "true") {
      descToggle.setAttribute("aria-expanded", "false");
      descToggle.innerHTML = icons.chevronRight;
      if (descChildren) descChildren.hidden = true;
    }
  }
}

function resetVisibility(root) {
  root.querySelectorAll(".tree-item").forEach((item) => {
    item.hidden = false;
  });
}

export function createTreeView({
  rootElement,
  statusElement,
  filterInput,
  onSelect,
  onOpen,
  onClose,
  loadChildren,
  loadLazyChildren,
  onError,
}) {
  let selectedItem = null;
  const loadedGroups = new Set();

  function getNodeKey(node) {
    const fileKey = node.fileKey ? `${node.fileKey}:` : "";
    return `${fileKey}${node.path}`;
  }

  function markPreloadedGroups(node) {
    if (!node || node.type !== "group") {
      return;
    }
    if (Array.isArray(node.children)) {
      loadedGroups.add(getNodeKey(node));
      node.children.forEach((child) => markPreloadedGroups(child));
    }
  }

  function setStatus(message) {
    statusElement.textContent = message;
    statusElement.hidden = !message;
    if (message) {
      statusElement.classList.add("empty-state");
    } else {
      statusElement.classList.remove("empty-state");
    }
  }

  function reset() {
    clearElement(rootElement);
    loadedGroups.clear();
    selectedItem = null;
  }

  function selectNode(node, item) {
    rootElement.querySelectorAll(".tree-item.selected").forEach((entry) => {
      entry.classList.remove("selected");
      entry.setAttribute("aria-selected", "false");
    });

    selectedItem = item;
    selectedItem.classList.add("selected");
    selectedItem.setAttribute("aria-selected", "true");
    onSelect(node);
    if (node.type === "group") {
      const toggle = item.querySelector(":scope > .tree-row .tree-toggle");
      if (toggle?.getAttribute("aria-expanded") === "false") {
        void handleToggle(node, item, toggle);
      }
    }
  }

  async function handleToggle(node, item, toggle) {
    const childrenContainer = item.querySelector(":scope > .tree-children");
    if (!childrenContainer) {
      return;
    }

    const nodeKey = getNodeKey(node);
    if (!loadedGroups.has(nodeKey)) {
      try {
        const shouldUseLazyLoader = Boolean(node.lazyChildren && loadLazyChildren);
        const loader = shouldUseLazyLoader ? loadLazyChildren : loadChildren;
        if (typeof loader !== "function") {
          throw new Error("No loader available for tree node.");
        }
        const children = await loader(node);
        node.children = children;
        node.lazyChildren = false;
        renderChildren(
          childrenContainer,
          children,
          selectNode,
          handleToggle,
          onOpen,
          onClose,
        );
        loadedGroups.add(nodeKey);
      } catch (error) {
        onError?.(error.message);
        renderLoadError(childrenContainer, error?.message);
        toggle.setAttribute("aria-expanded", "true");
        toggle.innerHTML = icons.chevronDown;
        childrenContainer.hidden = false;
        return;
      }
    }

    const isExpanded = toggle.getAttribute("aria-expanded") === "true";
    toggle.setAttribute("aria-expanded", String(!isExpanded));
    toggle.innerHTML = isExpanded ? icons.chevronRight : icons.chevronDown;
    childrenContainer.hidden = isExpanded;
    if (isExpanded) collapseDescendants(item);
  }

  function renderNodes(nodes) {
    clearElement(rootElement);
    nodes.forEach((node) => {
      markPreloadedGroups(node);
      const item = createTreeItem(node, selectNode, handleToggle, onOpen, onClose);
      rootElement.appendChild(item);
    });
  }

  function appendNode(node) {
    markPreloadedGroups(node);
    const item = createTreeItem(node, selectNode, handleToggle, onOpen, onClose);
    const rootChildren = rootElement.querySelector(":scope > .tree-item > .tree-children");
    (rootChildren ?? rootElement).appendChild(item);
    return item;
  }

  function prependNode(node) {
    markPreloadedGroups(node);
    const item = createTreeItem(node, selectNode, handleToggle, onOpen, onClose);
    rootElement.prepend(item);
    return item;
  }

  function setRoot(nodes) {
    renderNodes(nodes);
  }

  async function expandAllGroups() {
    let hasCollapsedGroups = true;

    // Keep expanding until all groups are expanded
    while (hasCollapsedGroups) {
      const allItems = Array.from(rootElement.querySelectorAll(".tree-item"));
      hasCollapsedGroups = false;

      for (const item of allItems) {
        if (item.dataset.type === "group") {
          const toggle = item.querySelector(":scope > .tree-row .tree-toggle");
          const childrenContainer = item.querySelector(":scope > .tree-children");

          if (toggle && childrenContainer && toggle.getAttribute("aria-expanded") === "false") {
            hasCollapsedGroups = true;

            // Reconstruct node info from DOM attributes
            const path = item.dataset.path;
            const fileKey = item.dataset.fileKey || null;
            const nodeName = item.dataset.label;

            const nodeKey = getNodeKey({ path, fileKey });
            const node = {
              path: path,
              name: nodeName,
              type: "group",
              lazyChildren: !loadedGroups.has(nodeKey),
              fileKey: fileKey
            };

            try {
              await handleToggle(node, item, toggle);
            } catch (error) {
              console.warn("Failed to expand group:", path, error);
            }
          }
        }
      }
    }
  }

  async function applyFilter(query) {
    const term = query.trim().toLowerCase();

    if (!term) {
      resetVisibility(rootElement);
      const items = Array.from(rootElement.querySelectorAll(".tree-item"));
      items.forEach((item) => {
        const label = item.querySelector(".tree-label");
        if (label) {
          label.classList.remove("tree-match");
        }
      });
      setStatus("");
      return;
    }

    // Expand all groups to make all items searchable
    setStatus("Expanding tree for search...");
    try {
      await expandAllGroups();

      // Small delay to ensure DOM is fully updated
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.warn("Error expanding groups for search:", error);
    }

    const items = Array.from(rootElement.querySelectorAll(".tree-item"));
    let matchCount = 0;

    items.forEach((item) => {
      item.hidden = true;
      const label = item.querySelector(".tree-label");
      if (label) {
        label.classList.remove("tree-match");
      }
    });

    items.forEach((item) => {
      const name = item.dataset.name ?? "";
      const path = item.dataset.path?.toLowerCase() ?? "";

      // Search in both name and full path
      if (name.includes(term) || path.includes(term)) {
        revealItem(item);
        const label = item.querySelector(".tree-label");
        if (label) {
          label.classList.add("tree-match");
        }
        matchCount++;
      }
    });

    if (matchCount === 0) {
      setStatus("No matches found");
    } else {
      setStatus(`${matchCount} match${matchCount !== 1 ? "es" : ""} found`);
    }
  }

  filterInput.addEventListener("input", (event) => {
    void applyFilter(event.target.value);
  });

  return {
    setStatus,
    reset,
    setRoot,
    renderNodes,
    appendNode,
    prependNode,
  };
}
