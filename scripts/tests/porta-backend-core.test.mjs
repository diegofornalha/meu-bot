import { test } from "node:test";
import assert from "node:assert/strict";
import { portaParaInstalar } from "../../dist/main/maquina/porta-backend-core.js";

const base = { backendInstalled: false, backendSumiu: false, backendUnitPort: null, backendPort: null, portBusy: false, freePort: null };

test("porta para instalar: a do serviço que roda sem arquivos vem antes de tudo; depois a do .env; depois a livre; senão a do app", () => {
  assert.equal(portaParaInstalar({ ...base, backendSumiu: true, backendUnitPort: 8083, portBusy: true, freePort: 8084 }, 8083), 8083);
  assert.equal(portaParaInstalar({ ...base, backendSumiu: true, backendUnitPort: null, portBusy: true, freePort: 8084 }, 8083), 8083, "sem a porta do processo: a do app, nunca a livre");
  assert.equal(portaParaInstalar({ ...base, backendInstalled: true, backendPort: 8081 }, 8080), 8081);
  assert.equal(portaParaInstalar({ ...base, portBusy: true, freePort: 8081 }, 8080), 8081);
  assert.equal(portaParaInstalar(base, 8080), 8080);
});
