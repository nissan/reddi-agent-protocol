/**
 * A deliberately small JSON Schema validator, written for the repository checks that must enforce a
 * committed schema rather than treat it as advisory.
 *
 * Why not a library: the only Ajv in `node_modules` is a transitive draft-07 build pulled in by
 * eslint, and the schemas here declare draft 2020-12. Depending on a transitive package for a
 * submission gate, or downgrading the schemas to what that build understands, both trade enforcement
 * for convenience. The keyword subset the schemas actually use is tiny, so it is implemented here.
 *
 * The safety property that makes this acceptable is refusal, not coverage: `compileJsonSchema`
 * throws on any keyword it does not implement, so a schema that grows a `$ref`, `anyOf`, `format`,
 * or `patternProperties` fails the check loudly instead of being validated less than it claims.
 * Silently ignoring an unknown keyword — the usual JSON Schema default — is the one behaviour a gate
 * must not have.
 */

const SUPPORTED_KEYWORDS = new Set([
  // Annotations: carried for humans, never assertions.
  "$schema", "$id", "title", "description", "default", "examples",
  // Assertions.
  "type", "enum", "const",
  "required", "properties", "additionalProperties",
  "items", "minItems", "maxItems", "uniqueItems",
  "minLength", "maxLength", "pattern",
  "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
]);

const SUPPORTED_TYPES = new Set(["object", "array", "string", "integer", "number", "boolean", "null"]);

function schemaTypeOf(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (Number.isInteger(value)) return "integer";
  return typeof value;
}

function matchesType(value, type) {
  const actual = schemaTypeOf(value);
  if (type === "number") return actual === "number" || actual === "integer";
  return actual === type;
}

/**
 * Walks the schema once, rejecting anything unimplemented and pre-compiling every `pattern`, so a
 * malformed or unsupported schema is a load-time refusal rather than a validation that quietly
 * proves less.
 */
function assertSupportedSchema(schema, pointer, compiledPatterns) {
  if (typeof schema === "boolean") return;
  if (schema === null || typeof schema !== "object" || Array.isArray(schema)) {
    throw new Error(`unsupported schema at ${pointer}: expected an object or boolean subschema`);
  }
  for (const keyword of Object.keys(schema)) {
    if (!SUPPORTED_KEYWORDS.has(keyword)) {
      throw new Error(`unsupported schema keyword "${keyword}" at ${pointer}`);
    }
  }
  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    for (const type of types) {
      if (!SUPPORTED_TYPES.has(type)) throw new Error(`unsupported schema type "${type}" at ${pointer}`);
    }
  }
  if ("pattern" in schema) {
    if (typeof schema.pattern !== "string") throw new Error(`invalid pattern at ${pointer}: expected a string`);
    try {
      compiledPatterns.set(`${pointer}/pattern`, new RegExp(schema.pattern, "u"));
    } catch (error) {
      throw new Error(`invalid pattern at ${pointer}: ${error.message}`);
    }
  }
  if ("required" in schema && !Array.isArray(schema.required)) {
    throw new Error(`invalid required at ${pointer}: expected an array`);
  }
  if ("properties" in schema) {
    if (schema.properties === null || typeof schema.properties !== "object" || Array.isArray(schema.properties)) {
      throw new Error(`invalid properties at ${pointer}: expected an object`);
    }
    for (const [name, subschema] of Object.entries(schema.properties)) {
      assertSupportedSchema(subschema, `${pointer}/properties/${escapePointerToken(name)}`, compiledPatterns);
    }
  }
  if ("additionalProperties" in schema) {
    assertSupportedSchema(schema.additionalProperties, `${pointer}/additionalProperties`, compiledPatterns);
  }
  if ("items" in schema) {
    if (Array.isArray(schema.items)) throw new Error(`unsupported tuple items at ${pointer}`);
    assertSupportedSchema(schema.items, `${pointer}/items`, compiledPatterns);
  }
}

function escapePointerToken(token) {
  return String(token).replaceAll("~", "~0").replaceAll("/", "~1");
}

function validateAgainst(schema, value, instancePointer, schemaPointer, compiledPatterns, errors) {
  if (schema === true || schema === undefined) return;
  if (schema === false) {
    errors.push({ path: instancePointer, message: "value is not allowed here" });
    return;
  }

  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push({
        path: instancePointer,
        message: `expected ${types.join(" or ")} but found ${schemaTypeOf(value)}`,
      });
      return; // Every other assertion below is type-specific; reporting them too is noise.
    }
  }
  if ("enum" in schema && !schema.enum.some((allowed) => allowed === value)) {
    errors.push({ path: instancePointer, message: `value is not one of ${JSON.stringify(schema.enum)}` });
  }
  if ("const" in schema && value !== schema.const) {
    errors.push({ path: instancePointer, message: `value must equal ${JSON.stringify(schema.const)}` });
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      errors.push({ path: instancePointer, message: `must be at least ${schema.minLength} character(s), found ${value.length}` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      errors.push({ path: instancePointer, message: `must be at most ${schema.maxLength} character(s), found ${value.length}` });
    }
    const pattern = compiledPatterns.get(`${schemaPointer}/pattern`);
    if (pattern && !pattern.test(value)) {
      errors.push({ path: instancePointer, message: `does not match ${schema.pattern}` });
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      errors.push({ path: instancePointer, message: `must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      errors.push({ path: instancePointer, message: `must be <= ${schema.maximum}` });
    }
    if (typeof schema.exclusiveMinimum === "number" && value <= schema.exclusiveMinimum) {
      errors.push({ path: instancePointer, message: `must be > ${schema.exclusiveMinimum}` });
    }
    if (typeof schema.exclusiveMaximum === "number" && value >= schema.exclusiveMaximum) {
      errors.push({ path: instancePointer, message: `must be < ${schema.exclusiveMaximum}` });
    }
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0 && !Number.isInteger(value / schema.multipleOf)) {
      errors.push({ path: instancePointer, message: `must be a multiple of ${schema.multipleOf}` });
    }
  }

  if (Array.isArray(value)) {
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      errors.push({ path: instancePointer, message: `must have at least ${schema.minItems} item(s), found ${value.length}` });
    }
    if (typeof schema.maxItems === "number" && value.length > schema.maxItems) {
      errors.push({ path: instancePointer, message: `must have at most ${schema.maxItems} item(s), found ${value.length}` });
    }
    if (schema.uniqueItems === true) {
      const seen = new Set(value.map((item) => JSON.stringify(item)));
      if (seen.size !== value.length) errors.push({ path: instancePointer, message: "items must be unique" });
    }
    if ("items" in schema) {
      value.forEach((item, index) => {
        validateAgainst(schema.items, item, `${instancePointer}/${index}`, `${schemaPointer}/items`, compiledPatterns, errors);
      });
    }
  }

  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const name of schema.required ?? []) {
      if (!Object.hasOwn(value, name)) {
        errors.push({ path: `${instancePointer}/${escapePointerToken(name)}`, message: "is required but missing" });
      }
    }
    const declared = schema.properties ?? {};
    // Schema-declaration order, then the remaining keys in document order: both are stable, so two
    // runs over the same document report the same diagnostics in the same sequence.
    for (const name of Object.keys(declared)) {
      if (!Object.hasOwn(value, name)) continue;
      validateAgainst(
        declared[name],
        value[name],
        `${instancePointer}/${escapePointerToken(name)}`,
        `${schemaPointer}/properties/${escapePointerToken(name)}`,
        compiledPatterns,
        errors,
      );
    }
    if ("additionalProperties" in schema) {
      for (const name of Object.keys(value)) {
        if (Object.hasOwn(declared, name)) continue;
        if (schema.additionalProperties === false) {
          errors.push({ path: `${instancePointer}/${escapePointerToken(name)}`, message: "is not a permitted property" });
          continue;
        }
        validateAgainst(
          schema.additionalProperties,
          value[name],
          `${instancePointer}/${escapePointerToken(name)}`,
          `${schemaPointer}/additionalProperties`,
          compiledPatterns,
          errors,
        );
      }
    }
  }
}

/**
 * Compiles `schema`, throwing on anything unsupported or malformed. The returned validator reports
 * every violation as `{ path, message }` with `path` a JSON Pointer into the validated document.
 */
export function compileJsonSchema(schema) {
  const compiledPatterns = new Map();
  assertSupportedSchema(schema, "#", compiledPatterns);
  return function validate(value) {
    const errors = [];
    validateAgainst(schema, value, "#", "#", compiledPatterns, errors);
    return errors;
  };
}

/** Bounded, deterministic rendering of validator output for a failing gate's stderr. */
export function formatSchemaErrors(errors, limit = 20) {
  const shown = errors.slice(0, limit).map((error) => `- ${error.path}: ${error.message}`);
  if (errors.length > limit) shown.push(`- ...and ${errors.length - limit} further violation(s)`);
  return shown.join("\n");
}
