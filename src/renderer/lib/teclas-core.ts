/**
 * A tecla dos atalhos do app por plataforma (caps.teclaCmd). No macOS é a ⌘, e a Ctrl é toda do shell quando o terminal
 * está em foco. Sem a ⌘ (Windows), a tecla do app é a Ctrl; com o terminal em foco a Ctrl sozinha continua do shell
 * (Ctrl+C, Ctrl+W…) e o atalho do app pede Ctrl+Shift. Puro: testável com node --test.
 */
export interface TeclasDoEvento { metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }

/** O evento traz a tecla do app? `noTerminal` = o foco está num terminal. */
export function temTeclaDoApp(ev: TeclasDoEvento, teclaCmd: boolean, noTerminal: boolean): boolean {
  if (teclaCmd) return ev.metaKey;
  return ev.ctrlKey && (!noTerminal || ev.shiftKey);
}

/** Com o terminal em foco, a tecla é do shell e o app não a toca? */
export function ehDoShell(ev: TeclasDoEvento, teclaCmd: boolean): boolean {
  return ev.ctrlKey && (teclaCmd ? !ev.metaKey : !ev.shiftKey);
}

/** Rótulo de um atalho da folha ("⌘⇧B") para a plataforma: com a ⌘ fica como está; sem ela, "Ctrl+Shift+B". */
export function rotuloTeclas(teclas: string, teclaCmd: boolean): string {
  if (teclaCmd) return teclas;
  return teclas.replace(/⌘/g, "Ctrl+").replace(/⇧/g, "Shift+").replace(/⌥/g, "Alt+");
}

/** Texto de dica escrito para o macOS ("Paleta de comandos (Cmd+K)") para a plataforma: sem a ⌘, Cmd vira Ctrl e Option vira Alt. */
export function dicaTeclas(texto: string, teclaCmd: boolean): string {
  if (teclaCmd) return texto;
  return texto.replace(/\bCmd\+/g, "Ctrl+").replace(/\bOption\+/g, "Alt+").replace(/⌘/g, "Ctrl+");
}
