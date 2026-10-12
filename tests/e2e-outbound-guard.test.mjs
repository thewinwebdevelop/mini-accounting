import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);
test("outbound guard refuses every redirect, including POST and Request overrides, before any next hop", async () => {
  const hits = [];
  const target = createServer((req, res) => { hits.push(req.url); res.end("escaped"); });
  target.listen(0, "127.0.0.1");
  await once(target, "listening");
  const source = createServer((req, res) => {
    if (req.url === "/ok") { res.end("ok"); return; }
    const [_, status, destination] = req.url.split("/");
    res.writeHead(Number(status), { location: destination === "same" ? "/ok" : `http://127.0.0.1:${target.address().port}/escaped` });
    res.end();
  });
  source.listen(0, "127.0.0.1");
  await once(source, "listening");
  try {
    const origin = `http://127.0.0.1:${source.address().port}`;
    await exec(process.execPath, ["--import", new URL("../e2e/fixtures/outbound-guard.mjs", import.meta.url).href, "--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      const origin = ${JSON.stringify(origin)};
      assert.equal(await fetch(origin + '/ok').then(r => r.text()), 'ok');
      for (const status of [301, 302, 303, 307, 308]) {
        for (const method of ['GET', 'POST']) {
          for (const destination of ['same', 'external']) {
            const url = origin + '/' + status + '/' + destination;
            const options = { method, ...(method === 'POST' ? { body: 'secret-body' } : {}) };
            await assert.rejects(fetch(url, options));
            await assert.rejects(fetch(url, { ...options, redirect: 'follow' }));
            await assert.rejects(fetch(new Request(url, { ...options, redirect: 'follow' })));
            await assert.rejects(fetch(url, { ...options, redirect: 'manual' }));
          }
        }
      }
    `], { env: { ...process.env, E2E_ALLOWED_HOSTS: new URL(origin).host } });
    assert.deepEqual(hits, []);
  } finally {
    await Promise.all([new Promise(resolve => source.close(resolve)), new Promise(resolve => target.close(resolve))]);
  }
});
