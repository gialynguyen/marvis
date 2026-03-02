import type { TObject, TSchema } from "@sinclair/typebox";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

/**
 * Schema-aware value coercion for LLM-provided config values.
 *
 * LLMs frequently send all values as strings regardless of the target type.
 * This function uses the TypeBox schema to determine the expected type and
 * coerces the value accordingly:
 *
 * 1. JSON array/object strings: `'["a","b"]'` → `["a","b"]`
 * 2. Schema-aware scalars: `"true"` → `true`, `"3456"` → `3456`
 * 3. Special keys: `load_on_startup` / `loadOnStartup` → coerced as boolean
 * 4. Fallback: returns value as-is
 */
export function coerceValue(schema: TObject, key: string, value: unknown): unknown {
  // Step 1: JSON array/object coercion (Value.Convert can't handle these)
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (
      (trimmed.startsWith("[") && trimmed.endsWith("]")) ||
      (trimmed.startsWith("{") && trimmed.endsWith("}"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        // Not valid JSON — fall through to schema-aware coercion
      }
    }
  }

  // Step 2: Handle load_on_startup / loadOnStartup specially (not in plugin schemas)
  if (key === "load_on_startup" || key === "loadOnStartup") {
    return Value.Convert(Type.Boolean(), value);
  }

  // Step 3: Schema-aware scalar coercion using TypeBox
  const propertySchema = findPropertySchema(schema, key);
  if (propertySchema && typeof value === "string") {
    return Value.Convert(propertySchema, value);
  }

  // Step 4: Fallback — return as-is
  return value;
}

/**
 * Find the schema for a specific property key in a TObject schema.
 * Handles both camelCase and snake_case lookups.
 */
function findPropertySchema(schema: TObject, key: string): TSchema | undefined {
  const properties = schema.properties as Record<string, TSchema> | undefined;
  if (!properties) return undefined;

  // Direct match
  if (properties[key]) return properties[key];

  // Try snake_case → camelCase conversion
  const camelKey = key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
  if (camelKey !== key && properties[camelKey]) return properties[camelKey];

  // Try camelCase → snake_case conversion
  const snakeKey = key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
  if (snakeKey !== key && properties[snakeKey]) return properties[snakeKey];

  return undefined;
}
