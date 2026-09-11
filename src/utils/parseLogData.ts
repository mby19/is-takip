/**
 * Denetim kaydının veri alanını ayrıştırır.
 *
 * İki format desteklenir:
 *  - JSON (yeni kayıtlar, `json_object` ile yazılır)
 *  - `anahtar=değer|anahtar=değer` (eski kayıtlar — geriye dönük uyumluluk)
 *
 * Dönüş her zaman düz bir `Record<string, string>`; JSON içindeki iç içe
 * değerler (örn. `atts` dizisi) metne çevrilerek saklanır, çağıran taraf
 * gerekiyorsa `JSON.parse` eder.
 */
export function parseLogData(data: string | null): Record<string, string> | null {
  if (!data) return null;
  const trimmed = data.trim();
  if (!trimmed) return null;

  if (trimmed.startsWith("{")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const flat: Record<string, string> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          if (value === null || value === undefined) continue;
          flat[key] = typeof value === "string" ? value : JSON.stringify(value);
        }
        return flat;
      }
    } catch {
      /* JSON değilse aşağıdaki formatlara düşülür */
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

export interface AttendanceSnapshotEntry {
  id: number;
  name: string;
  status: string;
}

/**
 * Gün özetindeki personel anlık görüntüsünü ayrıştırır.
 *
 * Yeni format: `[{"id":1,"name":"Ahmet","status":"FULL"}, ...]` (JSON)
 * Eski format: `1:Ahmet:FULL, 2:Mehmet:YOK`
 *
 * Eski format, isimde `:` veya `,` geçtiğinde bozulabilir; bu yüzden yeni
 * kayıtlar JSON olarak yazılır. Ayrıştırıcı ikisini de okur.
 */
export function parseAttendanceSnapshot(raw: string | null | undefined): AttendanceSnapshotEntry[] {
  if (!raw) return [];
  const trimmed = raw.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((e): e is Record<string, unknown> => !!e && typeof e === "object")
          .map((e) => ({
            id: Number(e.id),
            name: String(e.name ?? ""),
            status: String(e.status ?? "YOK"),
          }))
          .filter((e) => Number.isFinite(e.id));
      }
    } catch {
      /* eski formata düşülür */
    }
  }

  return trimmed
    .split(",")
    .map((part) => part.trim().split(":"))
    .filter((sub) => sub.length >= 3)
    .map((sub) => ({ id: Number(sub[0]), name: sub[1], status: sub[2] }))
    .filter((e) => Number.isFinite(e.id));
}
