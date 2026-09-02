/**
 * Minimal YAML reader for GitHub Actions workflow files.
 *
 * The lane boundary regressions assert on the *meaning* of the workflows (which paths trigger the
 * job, which Node version the setup step requests), so they need a semantic model rather than text
 * matching. Doing that with `js-yaml` made a gating CI step depend on a package the repository never
 * declares — it is only present because a lint transitive hoists it — so the lane would go red for a
 * reason unrelated to the lane the first time that hoist changes.
 *
 * This covers the subset workflow files actually use: block mappings, block sequences, flow
 * sequences of plain scalars, single/double quoted scalars, literal/folded block scalars, and
 * comments. Anything outside that subset throws instead of being silently mis-read.
 */

const BLOCK_SCALAR = /^([|>])([-+]?)(\d*)$/;

class WorkflowYamlError extends Error {
  constructor(message, lineNumber) {
    super(lineNumber === undefined ? message : `${message} (line ${lineNumber + 1})`);
    this.name = "WorkflowYamlError";
  }
}

function isBlank(line) {
  return line.trim() === "";
}

function isComment(line) {
  return line.trimStart().startsWith("#");
}

function indentOf(line) {
  return line.length - line.trimStart().length;
}

/** Drops a trailing `# ...` comment, ignoring `#` inside quoted scalars. */
function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(text[i - 1]))) return text.slice(0, i).trimEnd();
  }
  return text.trimEnd();
}

/** Splits `key: value` at the first `:` that is outside quotes and followed by space or end. */
function splitKey(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ":" && (i + 1 === text.length || /\s/.test(text[i + 1]))) {
      return { key: text.slice(0, i).trim(), rest: text.slice(i + 1).trim() };
    }
  }
  return null;
}

function splitFlowItems(inner) {
  const items = [];
  let current = "";
  let quote = null;
  for (const char of inner) {
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (char === ",") {
      items.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim() !== "" || items.length) items.push(current);
  return items;
}

function unquote(text) {
  if (text.length >= 2 && text.startsWith('"') && text.endsWith('"')) {
    return text.slice(1, -1).replace(/\\(.)/g, "$1");
  }
  if (text.length >= 2 && text.startsWith("'") && text.endsWith("'")) {
    return text.slice(1, -1).split("''").join("'");
  }
  return text;
}

function parseScalar(raw) {
  const text = raw.trim();
  if (text === "" || text === "~" || text === "null") return null;
  if (text.startsWith("[") && text.endsWith("]")) {
    return splitFlowItems(text.slice(1, -1)).map((item) => parseScalar(item));
  }
  if (text.startsWith("{") && text.endsWith("}")) {
    const out = {};
    for (const item of splitFlowItems(text.slice(1, -1))) {
      const split = splitKey(item.trim());
      if (!split) throw new WorkflowYamlError(`unsupported flow mapping entry: ${item}`);
      out[unquote(split.key)] = parseScalar(split.rest);
    }
    return out;
  }
  if (text.startsWith('"') || text.startsWith("'")) return unquote(text);
  if (text === "true") return true;
  if (text === "false") return false;
  if (/^-?\d+$/.test(text)) return Number(text);
  if (/^-?\d*\.\d+$/.test(text)) return Number(text);
  return text;
}

function readBlockScalar(lines, cursor, parentIndent, style) {
  const collected = [];
  while (cursor.index < lines.length) {
    const line = lines[cursor.index];
    if (!isBlank(line) && indentOf(line) <= parentIndent) break;
    collected.push(line);
    cursor.index += 1;
  }
  while (collected.length && isBlank(collected[collected.length - 1])) collected.pop();
  if (!collected.length) return "";
  const contentIndent = Math.min(...collected.filter((line) => !isBlank(line)).map(indentOf));
  const body = collected.map((line) => (isBlank(line) ? "" : line.slice(contentIndent)));
  return style === ">" ? `${body.join(" ").trim()}\n` : `${body.join("\n")}\n`;
}

function skipToContent(lines, cursor) {
  while (cursor.index < lines.length && (isBlank(lines[cursor.index]) || isComment(lines[cursor.index]))) {
    cursor.index += 1;
  }
}

function isSequenceLine(trimmed) {
  return trimmed === "-" || trimmed.startsWith("- ");
}

function parseNode(lines, cursor, minIndent) {
  skipToContent(lines, cursor);
  if (cursor.index >= lines.length) return null;
  const indent = indentOf(lines[cursor.index]);
  if (indent < minIndent) return null;
  return isSequenceLine(lines[cursor.index].trimStart())
    ? parseSequence(lines, cursor, indent)
    : parseMapping(lines, cursor, indent);
}

function parseSequence(lines, cursor, indent) {
  const out = [];
  for (;;) {
    skipToContent(lines, cursor);
    if (cursor.index >= lines.length) break;
    const line = lines[cursor.index];
    if (indentOf(line) !== indent || !isSequenceLine(line.trimStart())) break;
    const rest = stripComment(line.trimStart().slice(1)).trim();
    if (rest === "") {
      cursor.index += 1;
      out.push(parseNode(lines, cursor, indent + 1));
      continue;
    }
    if (splitKey(rest)) {
      // `- key: value` starts a mapping whose first key sits two columns right of the dash.
      lines[cursor.index] = `${" ".repeat(indent + 1)}${line.trimStart().slice(1)}`;
      out.push(parseMapping(lines, cursor, indent + 2));
      continue;
    }
    cursor.index += 1;
    out.push(parseScalar(rest));
  }
  return out;
}

function parseMapping(lines, cursor, indent) {
  const out = {};
  for (;;) {
    skipToContent(lines, cursor);
    if (cursor.index >= lines.length) break;
    const line = lines[cursor.index];
    if (indentOf(line) !== indent || isSequenceLine(line.trimStart())) break;
    const content = stripComment(line.trimStart());
    const split = splitKey(content);
    if (!split) throw new WorkflowYamlError(`unsupported line: ${content}`, cursor.index);
    const key = unquote(split.key);
    cursor.index += 1;
    const blockScalar = BLOCK_SCALAR.exec(split.rest);
    if (blockScalar) {
      out[key] = readBlockScalar(lines, cursor, indent, blockScalar[1]);
    } else if (split.rest === "") {
      // A nested block may sit at a deeper indent, or (for sequences) at the key's own indent.
      const restore = cursor.index;
      skipToContent(lines, cursor);
      const nested =
        cursor.index < lines.length && indentOf(lines[cursor.index]) === indent && isSequenceLine(lines[cursor.index].trimStart())
          ? parseSequence(lines, cursor, indent)
          : ((cursor.index = restore), parseNode(lines, cursor, indent + 1));
      out[key] = nested;
    } else {
      out[key] = parseScalar(split.rest);
    }
  }
  return out;
}

/** Parses a GitHub Actions workflow document into a plain JavaScript value. */
export function parseWorkflowYaml(text) {
  const lines = String(text)
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "---" && line.trim() !== "...");
  const cursor = { index: 0 };
  const value = parseNode(lines, cursor, 0);
  skipToContent(lines, cursor);
  if (cursor.index < lines.length) {
    throw new WorkflowYamlError(`unparsed trailing content: ${lines[cursor.index].trim()}`, cursor.index);
  }
  return value;
}

export { WorkflowYamlError };
