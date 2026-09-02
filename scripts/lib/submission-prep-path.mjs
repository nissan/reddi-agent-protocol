import { existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `artifacts/economic-demo-submission-prep/latest` is a generated convenience
 * symlink that is deliberately not committed — only the timestamped run
 * directories are. Guards resolve the newest committed run rather than
 * requiring an artifact the repository does not contain. See
 * docs/PUBLIC-CLAIM-BOUNDARY.md § Evidence artifacts that are not committed.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PARENT_DIR = join(ROOT, "artifacts", "economic-demo-submission-prep");

/** Canonical repository-relative identifier, used for guard file lists and reporting. */
export const SUBMISSION_PREP_LATEST_PATH = "artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md";

/** Absolute path to the newest committed submission prep, independent of cwd. */
export function resolveSubmissionPrepPath() {
  const latest = join(ROOT, SUBMISSION_PREP_LATEST_PATH);
  if (existsSync(latest)) return latest;
  if (!existsSync(PARENT_DIR)) return latest;
  const newest = readdirSync(PARENT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => join(PARENT_DIR, entry.name, "SUBMISSION-PREP.md"))
    .filter((path) => existsSync(path))
    .sort()
    .at(-1);
  return newest ?? latest;
}
