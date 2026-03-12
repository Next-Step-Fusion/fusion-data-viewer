import assert from "node:assert/strict";
import { buildTree } from "../data/tree.js";

const sampleNodes = [
  { name: "group-a", path: "/group-a", type: "group" },
  { name: "dataset-1", path: "/group-a/dataset-1", type: "dataset" },
  { name: "group-b", path: "/group-a/group-b", type: "group" },
  { name: "dataset-2", path: "/group-a/group-b/dataset-2", type: "dataset" },
];

const tree = buildTree(sampleNodes);

assert.equal(tree.children.length, 1);
assert.equal(tree.children[0].path, "/group-a");
assert.equal(tree.children[0].children.length, 2);

const [firstChild, secondChild] = tree.children[0].children;
assert.equal(firstChild.type, "dataset");
assert.equal(secondChild.type, "group");
assert.equal(secondChild.children[0].path, "/group-a/group-b/dataset-2");

console.log("tree.test.mjs passed");
