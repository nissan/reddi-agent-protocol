import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * `artifacts/economic-demo-submission-prep/latest` is a generated convenience
 * symlink that is deliberately not committed — only the timestamped run
 * directories are. Guards resolve the newest committed run rather than
 * requiring an artifact the repository does not contain. See
 * docs/PUBLIC-CLAIM-BOUNDARY.md § Evidence artifacts that are not committed.
 */
export const SUBMISSION_PREP_PARENT_DIR = "artifacts/economic-demo-submission-prep";
export const SUBMISSION_PREP_LATEST_PATH = `${SUBMISSION_PREP_PARENT_DIR}/latest/SUBMISSION-PREP.md`;

export function resolveSubmissionPrepPath() {
  if (existsSync(SUBMISSION_PREP_LATEST_PATH)) return SUBMISSION_PREP_LATEST_PATH;
  if (!existsSync(SUBMISSION_PREP_PARENT_DIR)) return SUBMISSION_PREP_LATEST_PATH;
  const newest = readdirSync(SUBMISSION_PREP_PARENT_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^\d{8}T\d{6}Z$/.test(entry.name))
    .map((entry) => join(SUBMISSION_PREP_PARENT_DIR, entry.name, "SUBMISSION-PREP.md"))
    .filter((path) => existsSync(path))
    .sort()
    .at(-1);
  return newest ?? SUBMISSION_PREP_LATEST_PATH;
}
