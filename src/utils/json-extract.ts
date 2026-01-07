export interface ExtractJsonResult {
  jsonText?: string;
  parsed?: any;
  error?: string;
}

/**
 * Extract and parse a JSON object from text.
 * - Accepts raw JSON, a JSON code fence, or text containing a single JSON object.
 * - Returns parsed object and the exact JSON substring used.
 */
export function extractJsonObject(text: string): ExtractJsonResult {
  const trimmed = (text || '').trim();
  if (!trimmed) return { error: 'Empty output' };

  // Direct parse
  try {
    const parsed = JSON.parse(trimmed);
    return { parsed, jsonText: trimmed };
  } catch {}

  // Code fence extraction
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence && fence[1]) {
    const candidate = fence[1].trim();
    try {
      const parsed = JSON.parse(candidate);
      return { parsed, jsonText: candidate };
    } catch (e) {
      return { error: `Failed to parse JSON in code fence: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  // Best-effort substring extraction: first "{" .. last "}"
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    const candidate = trimmed.slice(start, end + 1);
    try {
      const parsed = JSON.parse(candidate);
      return { parsed, jsonText: candidate };
    } catch (e) {
      return { error: `Failed to parse JSON object substring: ${e instanceof Error ? e.message : String(e)}` };
    }
  }

  return { error: 'Could not locate a JSON object in output' };
}

