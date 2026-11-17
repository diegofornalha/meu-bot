/** Janela de alívio: etapas, números de antes/depois e fechamento automático. */
import type { ReliefEvent } from "../shared/ipc";

interface ReliefApi { close(): void; openReset(): Promise<boolean>; on(channel: "relief:event", cb: (payload: unknown) => void): () => void }
declare global { interface Window { relief: ReliefApi } }

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
const title = $<HTMLHeadingElement>("rl-title");
const result = $<HTMLParagraphElement>("rl-result");
const closeBtn = $<HTMLButtonElement>("rl-close");
const resetBtn = $<HTMLButtonElement>("rl-reset");

function setStep(step: string, state: "doing" | "done" | "fail", text: string): void {
  const li = document.getElementById(`st-${step}`);
  if (li === null) return;
  li.classList.remove("doing", "done", "fail");
  li.classList.add(state);
  const detail = li.querySelector<HTMLSpanElement>(".detail");
  if (detail !== null) detail.textContent = text;
}

function setStats(which: "before" | "after", load: string, memMb: number | null): void {
  $<HTMLDivElement>(`${which}-load`).textContent = `carga ${load}`;
  $<HTMLDivElement>(`${which}-mem`).textContent = memMb === null ? "" : `${(memMb / 1024).toFixed(1)} GB livres`;
}

window.relief.on("relief:event", (p) => {
  const ev = p as ReliefEvent;
  switch (ev.kind) {
    case "init": title.textContent = `Aliviando ${ev.host}…`; document.body.classList.toggle("sem-semaforo", !ev.semaforoNaBarra); break;
    case "step": setStep(ev.step, ev.state, ev.text); break;
    case "stats": setStats(ev.which, ev.load, ev.memMb); break;
    case "countdown": setStep("open", "doing", `abrindo o meu-bot em ${ev.seconds} s…`); break;
    case "log": break;
    case "reset-countdown":
      result.hidden = false;
      result.className = "result bad";
      result.textContent = `✗ O pod pode estar congelado pelo host. Abrindo o app do Grok Bot no card \"Reset computer\" em ${ev.seconds} s… (Fechar cancela; o reset é o seu clique lá.)`;
      resetBtn.textContent = "Abrir agora";
      break;
    case "reset-opened":
      result.className = `result ${ev.ok ? "ok" : "bad"}`;
      result.textContent = ev.ok ? "O app do Grok Bot abriu no card \"Reset computer\". O reset é o seu clique no botão vermelho lá." : "✗ Não achei quem atenda grokbot:// neste Mac.";
      resetBtn.hidden = true;
      break;
    case "done":
      result.hidden = false;
      result.className = `result ${ev.ok ? "ok" : "bad"}`;
      result.textContent = ev.ok ? "✓ Alívio aplicado. Abrindo a janela da máquina." : `✗ ${ev.text}`;
      title.textContent = ev.ok ? "Aliviado" : "Não deu";
      resetBtn.hidden = ev.ok; // só quando o alívio não alcançou: pod congelado pelo host
      break;
  }
});

closeBtn.addEventListener("click", () => window.relief.close());
resetBtn.addEventListener("click", () => {
  resetBtn.disabled = true;
  void window.relief.openReset().then((ok) => {
    result.hidden = false;
    result.className = `result ${ok ? "ok" : "bad"}`;
    result.textContent = ok ? "O app do Grok Bot abriu no card \"Reset computer\". O reset é o seu clique no botão vermelho lá." : "✗ Não achei quem atenda grokbot:// neste Mac.";
  }).finally(() => { resetBtn.disabled = false; });
});
document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") window.relief.close(); });
