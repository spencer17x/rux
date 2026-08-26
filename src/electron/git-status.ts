export type ParsedGitStatus = { statusCode: string; filePath: string };

export function parsePorcelainV1Z(output: string): ParsedGitStatus[] {
  const entries = output.split("\0");
  const result: ParsedGitStatus[] = [];
  for (let index = 0; index < entries.length; index += 1) {
    const line = entries[index];
    if (!line || line.length < 4) continue;
    const statusCode = line.slice(0, 2);
    result.push({ statusCode, filePath: line.slice(3) });
    if (/[RC]/.test(statusCode)) index += 1;
  }
  return result;
}

export function parseNumstatZ(output: string): Map<string, { plus: number; minus: number }> {
  const result = new Map<string, { plus: number; minus: number }>();
  const entries = output.split("\0");
  for (let index = 0; index < entries.length; index += 1) {
    const match = entries[index].match(/^(\d+|-)\t(\d+|-)\t(.*)$/s);
    if (!match) continue;
    let filePath = match[3];
    if (!filePath) {
      index += 2;
      filePath = entries[index] || "";
    }
    if (filePath) result.set(filePath, { plus: Number(match[1]) || 0, minus: Number(match[2]) || 0 });
  }
  return result;
}
