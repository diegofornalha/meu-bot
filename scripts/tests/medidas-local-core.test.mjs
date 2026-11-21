// Memória e swap do "Este Mac" (src/main/maquina/medidas-local-core.ts), lidas do que o macOS imprime.
import { test } from "node:test";
import assert from "node:assert/strict";
import { memDisponivelMb, swapMb } from "../../dist/main/maquina/medidas-local-core.js";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                    35609.
Pages active:                                 375544.
Pages inactive:                               361466.
Pages speculative:                             13890.
Pages throttled:                                   0.
Pages wired down:                             121657.
Pages purgeable:                               23941.
"Translation faults":                       92244294.
`;

test("memDisponivelMb: livres + inativas + especulativas + descartáveis, no tamanho de página do Mac", () => {
  assert.equal(memDisponivelMb(VM_STAT), Math.round(((35609 + 361466 + 13890 + 23941) * 16384) / 1_048_576));
  // Intel: página de 4096 e sem a linha de descartáveis.
  assert.equal(memDisponivelMb("Mach Virtual Memory Statistics: (page size of 4096 bytes)\nPages free: 1000.\nPages inactive: 3000.\n"), Math.round((4000 * 4096) / 1_048_576));
  for (const lixo of ["", "vm_stat: comando não encontrado", "Pages free: 10.\nPages inactive: 10.\n", "(page size of 4096 bytes)\nPages free: 10.\n"]) assert.equal(memDisponivelMb(lixo), null);
});

test("swapMb: vírgula ou ponto, M ou G; sem swap é 0, saída estranha é null", () => {
  assert.deepEqual(swapMb("total = 2048,00M  used = 877,38M  free = 1170,62M  (encrypted)"), { swapTotalMb: 2048, swapFreeMb: 1171 });
  assert.deepEqual(swapMb("total = 3.00G  used = 1.50G  free = 1.50G  (encrypted)"), { swapTotalMb: 3072, swapFreeMb: 1536 });
  assert.deepEqual(swapMb("total = 0.00M  used = 0.00M  free = 0.00M  (encrypted)"), { swapTotalMb: 0, swapFreeMb: 0 });
  assert.deepEqual(swapMb(""), { swapTotalMb: null, swapFreeMb: null });
});
