import { expect, test } from "@playwright/test";

for (const kind of ["2d", "webgl", "webgl2"] as const) {
  test(`presents native ${kind} pixels, resize and input from a terminable Worker`, async ({ page }) => {
    await page.goto("/");
    await page.getByText("Run every language example").click();
    const block = page.locator('.rcb[data-language="web"]');
    const draw = kind === "2d"
      ? `ctx.fillStyle = green ? '#00ff00' : '#ff0000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
         console.log('pixel', Array.from(ctx.getImageData(0, 0, 1, 1).data).join(','));`
      : `ctx.viewport(0, 0, canvas.width, canvas.height);
         const shader = (type, source) => { const s = ctx.createShader(type); ctx.shaderSource(s, source); ctx.compileShader(s); if (!ctx.getShaderParameter(s, ctx.COMPILE_STATUS)) throw new Error(ctx.getShaderInfoLog(s)); return s; };
         const program = ctx.createProgram();
         ctx.attachShader(program, shader(ctx.VERTEX_SHADER, 'attribute vec2 position; void main() { gl_Position = vec4(position, 0.0, 1.0); }'));
         ctx.attachShader(program, shader(ctx.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 color; void main() { gl_FragColor = color; }'));
         ctx.linkProgram(program); if (!ctx.getProgramParameter(program, ctx.LINK_STATUS)) throw new Error(ctx.getProgramInfoLog(program)); ctx.useProgram(program);
         const buffer = ctx.createBuffer(); ctx.bindBuffer(ctx.ARRAY_BUFFER, buffer); ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1,-1,3,-1,-1,3]), ctx.STATIC_DRAW);
         const position = ctx.getAttribLocation(program, 'position'); ctx.enableVertexAttribArray(position); ctx.vertexAttribPointer(position, 2, ctx.FLOAT, false, 0, 0);
         ctx.uniform4f(ctx.getUniformLocation(program, 'color'), green ? 0 : 1, green ? 1 : 0, 0, 1); ctx.drawArrays(ctx.TRIANGLES, 0, 3);
         const pixel = new Uint8Array(4); ctx.readPixels(0, 0, 1, 1, ctx.RGBA, ctx.UNSIGNED_BYTE, pixel); console.log('pixel', Array.from(pixel).join(','));`;
    await block.locator(".cm-content").fill(`<canvas id="drawing" width="40" height="30"></canvas>
      <button id="paint">Resize and paint</button><button id="hang">Hang</button><script>
      const canvas = document.querySelector('#drawing'); const ctx = canvas.getContext('${kind}');
      if (!ctx) throw new Error('${kind} unavailable');
      function paint(green) { ${draw} }
      paint(false);
      document.querySelector('#paint').addEventListener('click', () => { canvas.width = 60; canvas.setAttribute('height', '45'); paint(true); });
      document.querySelector('#hang').addEventListener('click', () => { while (true) {} });
      </script>`);
    const created = page.waitForEvent("worker");
    await block.getByRole("button", { name: "Run code" }).click();
    const worker = await created;
    const preview = block.locator(".rcb__preview-frame").contentFrame().locator("#preview").contentFrame();
    const canvas = preview.locator("#drawing");
    const pixel = () => canvas.evaluate((element: HTMLCanvasElement) => Array.from(element.getContext("2d")?.getImageData(0, 0, 1, 1).data ?? []));
    await expect(block.locator(".rcb__output")).toContainText("pixel 255,0,0,255");
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
    await preview.getByRole("button", { name: "Resize and paint" }).click();
    await expect(canvas).toHaveAttribute("width", "60");
    await expect(canvas).toHaveAttribute("height", "45");
    await expect(block.locator(".rcb__output")).toContainText("pixel 0,255,0,255");
    await expect.poll(pixel).toEqual([0, 255, 0, 255]);
    const closed = worker.waitForEvent("close", { timeout: 6_000 });
    await preview.getByRole("button", { name: "Hang", exact: true }).click({ noWaitAfter: true });
    await block.getByRole("button", { name: "Stop", exact: true }).click();
    await closed;
    await expect(block).toHaveAttribute("data-state", "cancelled");
    await block.getByRole("button", { name: "Run code" }).click();
    await expect.poll(pixel).toEqual([255, 0, 0, 255]);
  });
}

test("keeps incremental 2D drawing across animation frames and bounds canvas allocations", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Run every language example").click();
  const block = page.locator('.rcb[data-language="web"]');
  await block.locator(".cm-content").fill(`<script>
    const canvas = document.createElement('canvas'); canvas.id = 'animated'; canvas.width = 40; canvas.height = 20; document.body.appendChild(canvas);
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0,0,20,20);
    setTimeout(() => requestAnimationFrame(() => { ctx.fillStyle = '#00ff00'; ctx.fillRect(20,0,20,20); console.log('painted'); }), 150);
    const huge = document.createElement('canvas'); huge.width = 100000; huge.height = 100000;
    try { huge.getContext('2d'); } catch (error) { console.log(error.message); }
    </script>`);
  await block.getByRole("button", { name: "Run code" }).click();
  await expect(block.locator(".rcb__output")).toContainText("Canvas size limit");
  await expect(block.locator(".rcb__output")).toContainText("painted");
  const canvas = block.locator(".rcb__preview-frame").contentFrame().locator("#preview").contentFrame().locator("#animated");
  await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => {
    const ctx = element.getContext("2d");
    if (!ctx) throw new Error("2D presentation unavailable");
    return [Array.from(ctx.getImageData(0,0,1,1).data), Array.from(ctx.getImageData(25,0,1,1).data)];
  })).toEqual([[255,0,0,255], [0,255,0,255]]);
});

test("rejects oversized bitmap messages even when author code bypasses the canvas bridge", async ({ page }) => {
  await page.goto("/");
  await page.getByText("Run every language example").click();
  const block = page.locator('.rcb[data-language="web"]');
  await block.locator(".cm-content").fill(`<script>
    const surface = new OffscreenCanvas(2049, 1); surface.getContext('2d').fillRect(0,0,2049,1);
    createImageBitmap(surface).then(bitmap => self.postMessage({rcb:'canvas', id:'rcb-canvas-ffffffffffffffffffffffffffffffff', bitmap}, [bitmap]));
    </script>`);
  await block.getByRole("button", { name: "Run code" }).click();
  await expect(block.locator(".rcb__output")).toContainText("canvas resource limit exceeded");
  await expect(block.getByRole("button", { name: "Run code" })).toBeEnabled();
});
