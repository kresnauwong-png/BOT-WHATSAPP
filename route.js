function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    "<": "&lt;",
    ">": "&gt;",
    "&": "&amp;",
    '"': "&quot;",
    "'": "&apos;",
  }[c]));
}

// Pecah teks jadi beberapa baris supaya tidak keluar dari kartu
function wrapText(text, maxCharsPerLine) {
  const words = text.split(/\s+/);
  const lines = [];
  let current = "";
  for (const w of words) {
    const next = current ? current + " " + w : w;
    if (next.length > maxCharsPerLine && current) {
      lines.push(current);
      current = w;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const THEMES = {
  dark: { bg: "#0b0b0b", text: "#ffffff", sub: "#9aa0a6" },
  light: { bg: "#ffffff", text: "#111111", sub: "#555555" },
};

export function buildQuoteCardSvg({ text, by, theme }) {
  const t = THEMES[theme] || THEMES.dark;
  const lines = wrapText(String(text || "").trim(), 28).slice(0, 8);
  const lineHeight = 56;
  const padding = 60;
  const textBlockHeight = lines.length * lineHeight;
  const bySpace = by ? 70 : 0;
  const height = padding * 2 + textBlockHeight + bySpace;
  const width = 720;

  const lineSvg = lines
    .map(
      (line, i) =>
        `<text x="${width / 2}" y="${padding + 40 + i * lineHeight}" font-family="Georgia, serif" font-size="40" font-weight="bold" fill="${t.text}" text-anchor="middle">${escapeXml(line)}</text>`
    )
    .join("\n");

  const bySvg = by
    ? `<text x="${width / 2}" y="${padding + textBlockHeight + 50}" font-family="Arial, sans-serif" font-size="24" fill="${t.sub}" text-anchor="middle">— ${escapeXml(by)}</text>`
    : "";

  return `
<svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
  <rect width="${width}" height="${height}" fill="${t.bg}"/>
  ${lineSvg}
  ${bySvg}
</svg>`.trim();
}
