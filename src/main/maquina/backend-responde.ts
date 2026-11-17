import http from "node:http";

/**
 * O backend responde pela porta local? Qualquer resposta HTTP prova o caminho inteiro (forward, conexão e backend).
 * Sem master, é a checagem que vale: a porta local aceita conexão mesmo com a conexão SSH do forward morta (depois de
 * o computador dormir, por exemplo), e um `ssh` novo provaria só que a máquina está no ar, não que este forward serve.
 */
export function backendResponde(port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get({ host: "127.0.0.1", port, path: "/health", timeout: timeoutMs }, (res) => { res.resume(); resolve(true); });
    req.on("timeout", () => { req.destroy(); resolve(false); });
    req.on("error", () => resolve(false));
  });
}
