/**
 * Registro dos corpos de passo do guia. Cada módulo de domínio registra os seus no próprio `ligar…()` (CRM em
 * crm-guia, grupos em grupos, login em contas-agente…), e o guia (tutoriais.ts) só
 * pergunta "quem desenha este body?". Aqui não entra import de módulo de domínio, para não haver ciclo:
 * tutoriais.ts → passos.ts ← domínio.
 */
import { el } from "../lib/dom.js";
import type { GuideStep, Tutorial } from "../lib/tutoriais.js";

export type PassoBody = NonNullable<GuideStep["body"]>;
/** Desenha o corpo do passo em `txt`. Devolver `false` = "não desenhei": o guia cai para o botão de ação do alvo. */
export type RenderPasso = (txt: HTMLElement, step: GuideStep, t: Tutorial) => void | false;

const registro = new Map<PassoBody, RenderPasso>();

/** Registra quem desenha cada body. O mesmo body duas vezes é erro de programação (dois módulos disputando o passo). */
export function registrarPassos<K extends PassoBody>(parte: Record<K, RenderPasso>): void {
  for (const body of Object.keys(parte) as K[]) {
    if (registro.has(body)) throw new Error(`passo ${body} registrado duas vezes`);
    registro.set(body, parte[body]);
  }
}
/** Desenha o passo; `true` = desenhou (o guia não põe botão de ação). Body sem renderizador: avisa no console e explica na tela. */
export function renderPasso(body: PassoBody, txt: HTMLElement, step: GuideStep, t: Tutorial): boolean {
  const r = registro.get(body);
  if (r === undefined) { console.error(`passo sem tela: ${body}`); txt.append(el("p", "hint", "Este passo ainda não tem tela nesta versão do app.")); return true; }
  return r(txt, step, t) !== false;
}
/** Bodies usados nos tutoriais que ninguém registrou (o renderer confere no fim da montagem da janela). */
export function conferirPassos(tutoriais: readonly Tutorial[]): PassoBody[] {
  const faltam = new Set<PassoBody>();
  for (const t of tutoriais) for (const s of t.steps) if (s.body !== undefined && !registro.has(s.body)) faltam.add(s.body);
  return [...faltam];
}
/** Só para os testes: esquece os registros. */
export function limparPassos(): void { registro.clear(); }
