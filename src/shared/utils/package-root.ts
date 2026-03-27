import { fileURLToPath } from "node:url";
import path from "node:path";

/** npm package root (parent of dist/), resolved from this module after compile. */
export function getPackageRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "..");
}
