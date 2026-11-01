import { test } from "node:test";
import assert from "node:assert/strict";
import { ehContaDesconectada, erroGoogleTexto, statusAposErro } from "../../dist/renderer/lib/erro-google.js";

const ipc = (code) => new Error(`Error invoking remote method 'gmail:listar': Error: ${code}`);
const status = { configurado: true, conectado: true, conectando: false, maquina: "agente-box", contaDoMac: null, precisaReconectar: false, gmailEscreve: true, perfil: { email: "voce@exemplo.com", nome: "Você", foto: null }, escopos: ["a"], cliente: { projeto: "p", origem: "o" } };

test("erroGoogleTexto: os três códigos viram frase; o resto passa sem o prefixo do Electron", () => {
  assert.equal(erroGoogleTexto(ipc("GOOGLE_CONTA_DESCONECTADA")), "a conta Google desconectou; entre de novo");
  assert.equal(erroGoogleTexto(new Error("PRO_REQUIRED")), "esta máquina não tem o plano Pro");
  assert.equal(erroGoogleTexto(ipc("GMAIL_SEM_PERMISSAO")), "a autorização desta conta é de antes da lixeira: reconecte a Conta Google uma vez");
  assert.equal(erroGoogleTexto(ipc("Google respondeu 500")), "Google respondeu 500");
  assert.equal(erroGoogleTexto("texto solto"), "texto solto");
});

test("ehContaDesconectada só para o código exato", () => {
  assert.equal(ehContaDesconectada(ipc("GOOGLE_CONTA_DESCONECTADA")), true);
  assert.equal(ehContaDesconectada(new Error("GOOGLE_CONTA_DESCONECTADA e mais")), false);
  assert.equal(ehContaDesconectada(ipc("PRO_REQUIRED")), false);
});

test("statusAposErro: conta desconectada vira status 'desconectada' (sem perfil); outros erros não mexem", () => {
  const depois = statusAposErro(status, ipc("GOOGLE_CONTA_DESCONECTADA"));
  assert.equal(depois.conectado, false); assert.equal(depois.perfil, null); assert.deepEqual(depois.escopos, []); assert.equal(depois.precisaReconectar, false);
  assert.equal(depois.configurado, true); assert.equal(depois.maquina, "agente-box");
  assert.equal(statusAposErro(status, ipc("PRO_REQUIRED")), status);
  assert.equal(statusAposErro(null, ipc("GOOGLE_CONTA_DESCONECTADA")), null);
});
