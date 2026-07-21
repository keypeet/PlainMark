// ประมาณขนาดการแก้ไขระหว่างเนื้อหาสองเวอร์ชัน (บรรทัดที่เพิ่ม/ลบ) — ใช้โชว์ในแผงประวัติว่าแต่ละเวอร์ชันแก้ไปเยอะแค่ไหน
// ไม่ใช่ full diff viewer เอาแค่ตัวเลขสรุปพอให้เทียบเวอร์ชันได้คร่าวๆ
export interface DiffStats {
  added: number;
  removed: number;
}

// เกินนี้ DP หา LCS ตรงๆ จะช้าเกิน (O(n*m)) — fallback ไปวิธีประมาณแบบนับบรรทัดซ้ำ (multiset)
const lcsCellLimit = 4_000_000;

export function lineDiffStats(oldText: string, newText: string): DiffStats {
  if (oldText === newText) return { added: 0, removed: 0 };
  const oldLines = oldText.length ? oldText.split('\n') : [];
  const newLines = newText.length ? newText.split('\n') : [];

  if (oldLines.length * newLines.length > lcsCellLimit) {
    return approximateDiffStats(oldLines, newLines);
  }

  const lcs = longestCommonSubsequenceLength(oldLines, newLines);
  return { added: newLines.length - lcs, removed: oldLines.length - lcs };
}

// DP มาตรฐานหาความยาว LCS ด้วยแถวหมุน O(min(n,m)) หน่วยความจำ
function longestCommonSubsequenceLength(a: string[], b: string[]): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  let prev = new Array<number>(short.length + 1).fill(0);
  let curr = new Array<number>(short.length + 1).fill(0);
  for (let i = 1; i <= long.length; i += 1) {
    for (let j = 1; j <= short.length; j += 1) {
      curr[j] = long[i - 1] === short[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1]);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[short.length];
}

// ไฟล์ใหญ่เกินจะทำ DP ตรงๆ ไม่ไหว — ประมาณคร่าวๆ ด้วยนับบรรทัดที่หายไป/งอกใหม่ (ไม่สนตำแหน่ง)
function approximateDiffStats(oldLines: string[], newLines: string[]): DiffStats {
  const remaining = new Map<string, number>();
  for (const line of oldLines) remaining.set(line, (remaining.get(line) ?? 0) + 1);
  for (const line of newLines) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) remaining.set(line, count - 1);
  }
  let removed = 0;
  for (const count of remaining.values()) removed += count;
  const matched = oldLines.length - removed;
  return { added: newLines.length - matched, removed };
}
