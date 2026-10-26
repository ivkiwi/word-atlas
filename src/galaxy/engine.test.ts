import assert from "node:assert/strict";
import { test } from "node:test";
import { GalaxyEngine } from "./engine";

test("context restoration rebuilds GPU resources with the latest star states and detaches on destroy", (t) => {
  const previousWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const previousCancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  Object.defineProperty(globalThis, "window", { configurable: true, value: { devicePixelRatio: 1 } });
  Object.defineProperty(globalThis, "cancelAnimationFrame", { configurable: true, value: () => {} });
  t.after(() => {
    for (const [name, descriptor] of [["window", previousWindow], ["cancelAnimationFrame", previousCancel]] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  let programs = 0;
  const buffers: Float32Array[] = [];
  const gl = {
    createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true,
    createProgram: () => { programs++; return {}; }, attachShader() {}, linkProgram() {}, getProgramParameter: () => true,
    createVertexArray: () => ({}), bindVertexArray() {}, createBuffer: () => ({}), bindBuffer() {},
    bufferData: (_target: number, data: Float32Array) => buffers.push(data.slice()), bufferSubData() {},
    getAttribLocation: () => 0, enableVertexAttribArray() {}, vertexAttribPointer() {},
  };
  class Canvas extends EventTarget {
    getContext() { return gl; }
    getBoundingClientRect() { return { width: 240, height: 240 }; }
  }
  const canvas = new Canvas();
  const engine = new GalaxyEngine(canvas as unknown as HTMLCanvasElement, {
    n: 1, positions: new Float32Array(3), colors: new Float32Array([1, 1, 1]), seeds: new Float32Array(1), ids: ["word"], index: new Map([["word", 0]]), topicCenters: [[0, 0, 0]],
  }, { quality: "low", reducedMotion: true });
  assert.equal(engine.webgl, true);
  assert.equal(programs, 2);
  const lost = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(lost);
  assert.equal(lost.defaultPrevented, true);
  engine.setState(0, 3);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.equal(programs, 4);
  assert.equal(buffers.length, 8);
  assert.deepEqual([...buffers.at(-1)!], [3]);
  engine.destroy();
  const detached = new Event("webglcontextlost", { cancelable: true });
  canvas.dispatchEvent(detached);
  canvas.dispatchEvent(new Event("webglcontextrestored"));
  assert.equal(detached.defaultPrevented, false);
  assert.equal(programs, 4);
});
