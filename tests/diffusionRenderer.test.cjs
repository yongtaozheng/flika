const assert = require('node:assert/strict')
const test = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

// Compile the DOM-free renderer with the project's existing TypeScript dependency.
const rendererPath = path.join(__dirname, '../src/utils/diffusionRenderer.ts')
const { outputText } = ts.transpileModule(fs.readFileSync(rendererPath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})
const sandbox = { exports: {} }
vm.runInNewContext(outputText, sandbox, { filename: rendererPath })
const { computeDistanceField, getTotalCycleDuration, renderFramePure } = sandbox.exports

function makeContext(config = {}, beats = [0, 1, 2, 3, 4], count = 2) {
  const width = 16
  const height = 16
  const colors = [[255, 0, 0], [0, 255, 0], [0, 0, 255]]
  const pixels = colors.map(color => {
    const data = new Uint8ClampedArray(width * height * 4)
    for (let i = 0; i < data.length; i += 4) data.set([...color, 255], i)
    return data
  })
  const points = [{ x: 0.5, y: 0.5 }]
  const distance = computeDistanceField(width, height, points)
  return {
    width, height,
    beats: beats.map(time => ({ time, strength: 1 })),
    config: {
      mode: 'transition', loop: false, beatSyncEnabled: true,
      spreadDuration: 500, pauseDuration: 0, edgeWidth: 8,
      rippleEnabled: true, bouncingBallEnabled: false, ...config,
    },
    images: Array.from({ length: count }, (_, i) => ({
      id: String(i), width, height, points,
      originalData: pixels[(i + 1) % pixels.length],
      grayscaleData: pixels[i % pixels.length],
      distanceField: distance.field, cosAngle: distance.cosAngle,
      sinAngle: distance.sinAngle, maxDist: distance.maxDist,
      spreadDuration: 500, pauseDuration: 0,
    })),
  }
}

test('non-looping beat transitions finish after their own beat segments', () => {
  const ctx = makeContext()
  assert.equal(getTotalCycleDuration(ctx), 2000)
  assert.equal(getTotalCycleDuration(ctx, true), 2000)
  for (const time of [2000, 2500, 4000, 10000]) {
    const frame = renderFramePure(ctx, time)
    assert.equal(frame.imageIndex, 1)
    assert.deepEqual([...frame.buffer.slice(0, 4)], [0, 0, 255, 255])
  }
})

test('short beat lists extrapolate enough segments to show the final image', () => {
  const ctx = makeContext({}, [0, 1], 3)
  assert.equal(getTotalCycleDuration(ctx), 3000)
  assert.deepEqual([...renderFramePure(ctx, 3000).buffer.slice(0, 4)], [255, 0, 0, 255])
})

test('zero-pause completion returns every pixel of the final image without ripple', () => {
  const ctx = makeContext({ beatSyncEnabled: false })
  assert.equal(getTotalCycleDuration(ctx), 1000)
  const frame = renderFramePure(ctx, 1000)
  assert.deepEqual([...frame.buffer], [...ctx.images[1].originalData])
  assert.equal(frame.spreadProgress, 1)
  assert.equal(frame.rippleActive, false)
  frame.buffer[0] = 42
  assert.equal(ctx.images[1].originalData[0], 0)
})

test('looping manual transitions still complete the return to the first image', () => {
  const ctx = makeContext({ beatSyncEnabled: false, loop: true }, [], 3)
  assert.equal(getTotalCycleDuration(ctx), 1500)
  assert.equal(renderFramePure(ctx, 1100).imageIndex, 2)
  const frame = renderFramePure(ctx, 1500)
  assert.equal(frame.imageIndex, 0)
  assert.deepEqual([...frame.buffer.slice(0, 4)], [255, 0, 0, 255])
})

test('colorize keeps its beat-cycle duration and supports one-pass export timing', () => {
  const ctx = makeContext({ mode: 'colorize' })
  assert.equal(getTotalCycleDuration(ctx), 4000)
  assert.equal(getTotalCycleDuration(ctx, true), 2000)
})

test('empty transition lists have no duration and render an empty frame', () => {
  const ctx = makeContext({}, [0, 1, 2], 0)
  assert.equal(getTotalCycleDuration(ctx), 0)
  assert.deepEqual([...renderFramePure(ctx, 0).buffer.slice(0, 4)], [0, 0, 0, 255])
})

test('the worker samples the completed image for the last encoded frame', () => {
  const ctx = makeContext({ beatSyncEnabled: false })
  const messages = []
  const workerPath = path.join(__dirname, '../src/workers/diffusionRender.worker.ts')
  const compiled = ts.transpileModule(fs.readFileSync(workerPath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  })
  const worker = {
    exports: {},
    require: () => sandbox.exports,
    self: { postMessage: message => messages.push(message) },
    setTimeout,
  }
  vm.runInNewContext(compiled.outputText, worker, { filename: workerPath })
  worker.self.onmessage({ data: {
    type: 'init', config: ctx.config, beats: [], width: ctx.width, height: ctx.height,
    totalFrames: 30, frameDurationMs: 1000 / 30, totalDurationMs: 1000, step: 1,
    images: ctx.images.map(image => ({
      ...image,
      originalData: image.originalData.buffer,
      grayscaleData: image.grayscaleData.buffer,
      distanceField: image.distanceField.buffer,
      cosAngle: image.cosAngle.buffer,
      sinAngle: image.sinAngle.buffer,
    })),
  } })
  worker.self.onmessage({ data: { type: 'render-batch', startFrame: 29, endFrame: 30 } })
  const frame = messages.find(message => message.type === 'frame-ready')
  assert.equal(frame.frameIndex, 29)
  assert.equal(frame.spreadProgress, 1)
  assert.deepEqual([...new Uint8ClampedArray(frame.buffer)], [...ctx.images[1].originalData])
})

test('looping beat transitions align the cycle to complete image sequences', () => {
  const ctx = makeContext({ loop: true, rippleEnabled: false }, [0, 1, 2, 3, 4], 3)
  assert.equal(getTotalCycleDuration(ctx), 6000)
  assert.equal(getTotalCycleDuration(ctx, true), 3000)
  const center = (8 * ctx.width + 8) * 4
  for (const [time, expected] of [
    [3999, [0, 255, 0, 255]], [4000, [0, 255, 0, 255]],
    [5999, [255, 0, 0, 255]], [6000, [255, 0, 0, 255]],
  ]) {
    assert.deepEqual([...renderFramePure(ctx, time).buffer.slice(center, center + 4)], expected)
  }
})

test('aligned beat loops preserve irregular beat times and extrapolate missing segments', () => {
  const ctx = makeContext({ loop: true, rippleEnabled: false }, [0, 0.5, 1.5, 2, 3.5], 3)
  assert.equal(getTotalCycleDuration(ctx), 5250)
  assert.equal(getTotalCycleDuration(ctx, true), 2000)
  for (const [time, imageIndex] of [[500, 1], [1500, 2], [2000, 0], [3500, 1], [4375, 2], [5250, 0]]) {
    assert.equal(renderFramePure(ctx, time).imageIndex, imageIndex)
  }
})

test('the soft edge keeps white pixels white while fading transparency in either direction', () => {
  const ctx = makeContext({ beatSyncEnabled: false, rippleEnabled: false }, [], 1)
  const transparent = new Uint8ClampedArray(ctx.width * ctx.height * 4)
  const white = new Uint8ClampedArray(transparent.length).fill(255)
  const index = (8 * ctx.width + 8) * 4
  const time = ctx.config.edgeWidth / 2 / ctx.images[0].maxDist * 500
  for (const [before, after] of [[transparent, white], [white, transparent]]) {
    ctx.images[0].grayscaleData = before
    ctx.images[0].originalData = after
    assert.deepEqual([...renderFramePure(ctx, time).buffer.slice(index, index + 4)], [255, 255, 255, 128])
  }
})

test('transparent-to-transparent blending clears hidden colors and never divides by zero', () => {
  const ctx = makeContext({ beatSyncEnabled: false, rippleEnabled: false }, [], 1)
  ctx.images[0].originalData.fill(200)
  ctx.images[0].grayscaleData.fill(50)
  for (let i = 3; i < ctx.images[0].originalData.length; i += 4) {
    ctx.images[0].originalData[i] = 0
    ctx.images[0].grayscaleData[i] = 0
  }
  const index = (8 * ctx.width + 8) * 4
  const time = ctx.config.edgeWidth / 2 / ctx.images[0].maxDist * 500
  assert.deepEqual([...renderFramePure(ctx, time).buffer.slice(index, index + 4)], [0, 0, 0, 0])
})

test('opaque soft-edge pixels retain ordinary color interpolation', () => {
  const ctx = makeContext({ beatSyncEnabled: false, rippleEnabled: false }, [], 1)
  const index = (8 * ctx.width + 8) * 4
  const time = ctx.config.edgeWidth / 2 / ctx.images[0].maxDist * 500
  assert.deepEqual([...renderFramePure(ctx, time).buffer.slice(index, index + 4)], [128, 128, 0, 255])
})

test('audio segment beats exclude outside beats and start at relative time zero', () => {
  const beats = Array.from({ length: 11 }, (_, time) => ({ time, strength: time / 10 }))
  const selected = sandbox.exports.getSegmentBeats(beats, 5, 8)
  assert.deepEqual(Array.from(selected, beat => beat.time), [0, 1, 2, 3])
  assert.deepEqual(Array.from(selected, beat => beat.strength), [0.5, 0.6, 0.7, 0.8])
  assert.equal(beats[5].time, 5)
  const ctx = makeContext()
  ctx.beats = selected
  assert.equal(getTotalCycleDuration(ctx), 2000)
  assert.equal(renderFramePure(ctx, 0).imageIndex, 0)
  assert.deepEqual([...renderFramePure(ctx, 2000).buffer.slice(0, 4)], [0, 0, 255, 255])
})

test('segments with no usable beats fall back to manual timing', () => {
  const selected = sandbox.exports.getSegmentBeats([{ time: 1, strength: 1 }], 5, 8)
  assert.equal(selected.length, 0)
  const ctx = makeContext()
  ctx.beats = selected
  assert.equal(getTotalCycleDuration(ctx), 1000)
})

test('the segment clock is relative to the selected start and remains continuous across wraps', () => {
  const clock = sandbox.exports.createAudioSegmentClock({ start: 5, end: 8, loop: true }, 100)
  assert.equal(clock.sample(5, true, 100), 0)
  assert.ok(Math.abs(clock.sample(7.9, true, 3000) - 2900) < 1e-6)
  assert.ok(Math.abs(clock.sample(5, false, 3100) - 3000) < 1e-6)
  assert.ok(Math.abs(clock.sample(5.1, true, 3200) - 3100) < 1e-6)
  clock.reset(6, 3300)
  assert.equal(clock.sample(6, true, 3300), 1000)
})

test('the clock completes remaining transitions after selected audio ends', () => {
  const clock = sandbox.exports.createAudioSegmentClock({ start: 5, end: 6, loop: false }, 0)
  assert.equal(clock.sample(5, true, 0), 0)
  assert.ok(Math.abs(clock.sample(5.9, true, 900) - 900) < 1e-6)
  assert.ok(Math.abs(clock.sample(5, false, 1000) - 1000) < 1e-6)
  assert.ok(Math.abs(clock.sample(5, false, 2000) - 2000) < 1e-6)
})

test('waiting for the first selected beat keeps progress at zero', () => {
  const ctx = makeContext()
  ctx.beats = sandbox.exports.getSegmentBeats([
    { time: 5.25, strength: 1 }, { time: 5.75, strength: 1 }, { time: 6.25, strength: 1 },
  ], 5, 8)
  const frame = renderFramePure(ctx, 0)
  assert.equal(frame.spreadProgress, 0)
  assert.deepEqual([...frame.buffer.slice(0, 4)], [255, 0, 0, 255])
})
