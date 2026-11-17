/**
 * O que a leitura de planilhas decide sem tocar na rede nem no Electron (planilha.ts é quem lê). Puro: testável com
 * node --test.
 */

/** Id da planilha a partir do link do Google Sheets (ou o próprio id colado). null = não parece uma planilha. */
export function idDaPlanilha(link: string): string | null {
  const s = link.trim();
  const m = /\/spreadsheets\/d\/([A-Za-z0-9_-]{20,})/.exec(s);
  if (m !== null) return m[1]!;
  return /^[A-Za-z0-9_-]{25,}$/.test(s) ? s : null;
}
