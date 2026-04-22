import { knownSchemas } from "../schemas/index.js";

export async function detectSchema(session, datasetIndex) {
  const pathSet = new Set(datasetIndex.map((d) => d.path));

  for (const schema of knownSchemas) {
    const { match } = schema;

    if (match.requiredPaths) {
      if (!match.requiredPaths.every((p) => pathSet.has(p))) continue;
    }

    if (match.rootAttributes) {
      let rootInfo;
      try {
        rootInfo = await session.getNodeInfo("/");
      } catch {
        continue;
      }
      const attrMap = Object.fromEntries(
        (rootInfo?.attributes ?? []).map(({ key, value }) => [key, value]),
      );
      const attrMatch = Object.entries(match.rootAttributes).every(
        ([key, expected]) => attrMap[key]?.includes(expected),
      );
      if (!attrMatch) continue;
    }

    return schema;
  }
  return null;
}
