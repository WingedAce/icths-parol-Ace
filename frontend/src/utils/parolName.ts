import type { ProjectNode } from "../types";

// The name to show people: the parol name an admin gave in the Developer
// Window, or the node's own name ("Group 3") when there isn't one.
export const displayName = (node: ProjectNode): string =>
  node.parolName?.trim() || node.name;

// The node's own name, but only when a custom parol name is hiding it. Shown
// in small text so students still know which group number opens the design.
export const originalNameIfRenamed = (node: ProjectNode): string | null =>
  node.parolName?.trim() ? node.name : null;
