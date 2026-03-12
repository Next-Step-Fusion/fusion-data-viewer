export function buildTree(nodes) {
  const root = {
    name: "/",
    path: "/",
    type: "group",
    children: [],
  };

  const nodesByPath = new Map([["/", root]]);

  nodes.forEach((node) => {
    const normalizedPath = node.path.startsWith("/") ? node.path : `/${node.path}`;
    const segments = normalizedPath.split("/").filter(Boolean);
    let currentPath = "";

    segments.forEach((segment, index) => {
      currentPath += `/${segment}`;
      if (!nodesByPath.has(currentPath)) {
        const newNode = {
          name: segment,
          path: currentPath,
          type: index === segments.length - 1 ? node.type : "group",
          children: [],
        };
        nodesByPath.set(currentPath, newNode);

        const parentPath = currentPath
          .split("/")
          .slice(0, -1)
          .join("/") || "/";
        const parent = nodesByPath.get(parentPath);
        if (parent) {
          parent.children.push(newNode);
        }
      }
    });
  });

  return root;
}
