export function parseLogData(data: string | null): Record<string, string> | null {
  if (!data) return null;
  const trimmed = data.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      /* fall through */
    }
  }

  if (trimmed.includes("=")) {
    const result: Record<string, string> = {};
    trimmed.split("|").forEach((part) => {
      const eqIdx = part.indexOf("=");
      if (eqIdx > 0) {
        result[part.substring(0, eqIdx).trim()] = part.substring(eqIdx + 1).trim();
      }
    });
    if (Object.keys(result).length > 0) return result;
  }

  const workerMatch = trimmed.match(/^Worker:\s*(.+)/i);
  if (workerMatch) return { name: workerMatch[1] };

  const attMatch = trimmed.match(/^Attendance:\s*(\w+)\s+on\s+(.+)/i);
  if (attMatch) return { status: attMatch[1], date: attMatch[2] };

  const statusMatch = trimmed.match(/^(?:Old|New):\s*(\w+)/i);
  if (statusMatch) return { status: statusMatch[1] };

  const prodMatch = trimmed.match(/^Production:\s*(\d+)/i);
  if (prodMatch) return { production: prodMatch[1] };

  return { _raw: trimmed };
}
