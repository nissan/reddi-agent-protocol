import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `artifacts/economic-demo-submission-prep/latest` is a generated convenience
 * symlink that is deliberately not committed — only the timestamped run
 * directories are. Guards resolve the newest committed run rather than
 * requiring an artifact the repository does not contain. The lookup reads
 * `HEAD` rather than the index, so a locally generated run that has only been
 * staged cannot be reported as committed evidence. See
 * docs/PUBLIC-CLAIM-BOUNDARY.md § Evidence artifacts that are not committed.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** Canonical repository-relative identifier, used for guard file lists and reporting. */
export const SUBMISSION_PREP_LATEST_PATH = "artifacts/economic-demo-submission-prep/latest/SUBMISSION-PREP.md";

function committedSubmissionPrepPaths() {
  const result = spawnSync(
    "git",
    ["-C", ROOT, "ls-tree", "-r", "--name-only", "HEAD", "--", "artifacts/economic-demo-submission-prep/"],
    { encoding: "utf8" },
  );
  if (result.status !== 0) return [];
  return result.stdout
    .split(/\r?\n/)
    .filter((rel) => /^artifacts\/economic-demo-submission-prep\/\d{8}T\d{6}Z\/SUBMISSION-PREP\.md$/.test(rel))
    .map((rel) => join(ROOT, rel))
    .filter((path) => existsSync(path))
    .sort();
}

/** Absolute path to the newest committed submission prep, independent of cwd. */
export function resolveSubmissionPrepPath() {
  const latest = join(ROOT, SUBMISSION_PREP_LATEST_PATH);
  const newest = committedSubmissionPrepPaths().at(-1);
  return newest ?? latest;
}

/**
 * Repository-relative path of the run a guard actually reads. Diagnostics must
 * name this rather than the `latest` key, which resolves to a file the
 * repository deliberately does not contain.
 */
export function resolveSubmissionPrepRepoPath() {
  return relative(ROOT, resolveSubmissionPrepPath()).split(sep).join("/");
}
