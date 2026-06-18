# Notice and License Scope

Unless a file says otherwise, original Reddi Agent Protocol source code and documentation in this repository are licensed under the MIT License in `LICENSE`.

That repository-level license does not override third-party rights or upstream terms for copied, vendored, generated, or externally sourced material. In particular:

- `third_party/` may contain upstream projects or vendored reference material governed by their own licenses.
- `ingests/` may contain copied or transformed external documentation, catalogs, research inputs, or source snapshots governed by the original source terms.
- `artifacts/` may contain generated evidence, screenshots, recordings, research outputs, or externally derived materials; these should not be treated as reusable MIT-licensed source unless an artifact explicitly says so.
- Public assets, generated media, benchmark inputs, and externally sourced docs retain their original ownership and usage restrictions unless explicitly relicensed by the rights holder.

Contributors should preserve upstream notices when adding third-party material and should prefer links or small quoted excerpts over copying external docs into the repo. If an external source must be checked in for reproducibility, document its origin, retrieval date, and license/usage boundary near the artifact.

Before publishing an npm package or other release artifact, inspect the packaged file list and exclude `ingests/`, `third_party/`, generated evidence, private logs, local artifacts, and unrelated app output unless that material is intentionally included with a compatible license.
