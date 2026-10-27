// WebGL2 color-grading pass: RGB curves + three-way color wheels + .cube LUT.
// One shared offscreen canvas + program; fed a source crop, returns a canvas
// that the main renderer draws with plain drawImage. Returns null when WebGL2
// is unavailable (caller keeps rendering ungraded — graceful degradation).
import type { ColorAdvanced, CurvePoint } from '@shared/document'
import { lutForPath } from './lut'

let glCanvas: HTMLCanvasElement | null = null
let gl: WebGL2RenderingContext | null = null
let program: WebGLProgram | null = null
let uniformLoc: Record<string, WebGLUniformLocation | null> = {}
let vao: WebGLVertexArrayObject | null = null
let srcTex: WebGLTexture | null = null
let curveTex: WebGLTexture | null = null
let cubeTex: WebGLTexture | null = null
let curveSign = ''
let cubePath = ''
let cubePathInFlight = ''

const VERT = `#version 300 es
layout(location=0) in vec2 aPos;
out vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}`

const FRAG = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform sampler2D uCurves; // 256x4 rows: master, red, green, blue
uniform highp sampler3D uCube;
uniform float uCurveMasterOn;
uniform vec3 uChanOn; // r,g,b curve gates
uniform vec3 uLift, uGamma, uGainWheel;
uniform float uCubeOn;
uniform float uCubeSize;
uniform float uCubeStrength;
in vec2 vUV;
out vec4 outColor;
const float TAU_Y = 1.0 / 4.0;
float curveRow(float x, float row) {
  return texture(uCurves, vec2(clamp(x, 1.0/512.0, 511.0/512.0), (row + 0.5) * TAU_Y)).r;
}
void main() {
  vec3 c = texture(uSrc, vUV).rgb;
  // Master curve drives luminance scale.
  float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
  if (uCurveMasterOn > 0.5) {
    float m = curveRow(lum, 0.0);
    c *= clamp(m / max(lum, 0.03), 0.35, 2.6);
  }
  c.r = mix(c.r, curveRow(c.r, 1.0), uChanOn.r);
  c.g = mix(c.g, curveRow(c.g, 2.0), uChanOn.g);
  c.b = mix(c.b, curveRow(c.b, 3.0), uChanOn.b);
  // Three-way wheels by luma bands.
  float l = dot(max(c, 0.0), vec3(0.2126, 0.7152, 0.0722));
  float wS = smoothstep(0.45, 0.02, l);
  float wH = smoothstep(0.55, 0.98, l);
  float wM = clamp(1.0 - wS - wH, 0.0, 1.0);
  c += uLift * wS + uGamma * wM + uGainWheel * wH;
  // External .cube LUT.
  if (uCubeOn > 0.5) {
    float n = uCubeSize;
    vec3 g = texture(uCube, clamp(c, 0.0, 1.0) * (1.0 - 1.0 / n) + 0.5 / n).rgb;
    c = mix(c, g, clamp(uCubeStrength, 0.0, 1.0));
  }
  outColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`

function initGL(): boolean {
  if (gl) return true
  if (!glCanvas) {
    glCanvas = document.createElement('canvas')
    glCanvas.width = 8
    glCanvas.height = 8
  }
  const ctx = glCanvas.getContext('webgl2', { alpha: false, antialias: false, preserveDrawingBuffer: true })
  if (!ctx) return false
  gl = ctx
  const compile = (type: number, src: string): WebGLShader | null => {
    const sh = ctx.createShader(type)
    if (!sh) return null
    ctx.shaderSource(sh, src)
    ctx.compileShader(sh)
    if (!ctx.getShaderParameter(sh, ctx.COMPILE_STATUS)) {
      ctx.deleteShader(sh)
      return null
    }
    return sh
  }
  const vs = compile(ctx.VERTEX_SHADER, VERT)
  const fs = compile(ctx.FRAGMENT_SHADER, FRAG)
  if (!vs || !fs) return false
  const prog = ctx.createProgram()
  if (!prog) return false
  ctx.attachShader(prog, vs)
  ctx.attachShader(prog, fs)
  ctx.linkProgram(prog)
  if (!ctx.getProgramParameter(prog, ctx.LINK_STATUS)) return false
  program = prog
  ctx.useProgram(prog)
  uniformLoc = {
    uSrc: ctx.getUniformLocation(prog, 'uSrc'),
    uCurves: ctx.getUniformLocation(prog, 'uCurves'),
    uCube: ctx.getUniformLocation(prog, 'uCube'),
    uCurveMasterOn: ctx.getUniformLocation(prog, 'uCurveMasterOn'),
    uChanOn: ctx.getUniformLocation(prog, 'uChanOn'),
    uLift: ctx.getUniformLocation(prog, 'uLift'),
    uGamma: ctx.getUniformLocation(prog, 'uGamma'),
    uGainWheel: ctx.getUniformLocation(prog, 'uGainWheel'),
    uCubeOn: ctx.getUniformLocation(prog, 'uCubeOn'),
    uCubeSize: ctx.getUniformLocation(prog, 'uCubeSize'),
    uCubeStrength: ctx.getUniformLocation(prog, 'uCubeStrength')
  }
  vao = ctx.createVertexArray()
  ctx.bindVertexArray(vao)
  const buf = ctx.createBuffer()
  ctx.bindBuffer(ctx.ARRAY_BUFFER, buf)
  ctx.bufferData(ctx.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), ctx.STATIC_DRAW)
  ctx.enableVertexAttribArray(0)
  ctx.vertexAttribPointer(0, 2, ctx.FLOAT, false, 0, 0)
  return true
}

function sampleCurve(points: CurvePoint[] | null | undefined, t: number): number {
  if (!points || points.length === 0) return t
  if (points.length === 1) return points[0].v
  if (t <= points[0].t) return points[0].v
  if (t >= points[points.length - 1].t) return points[points.length - 1].v
  for (let i = 0; i < points.length - 1; i++) {
    if (t >= points[i].t && t <= points[i + 1].t) {
      const span = points[i + 1].t - points[i].t
      const f = span <= 0 ? 0 : (t - points[i].t) / span
      return points[i].v + (points[i + 1].v - points[i].v) * f
    }
  }
  return t
}

function ensureCurves(adv: ColorAdvanced): void {
  if (!gl || !program) return
  const sign = JSON.stringify([adv.master, adv.red, adv.green, adv.blue])
  if (sign === curveSign && curveTex) return
  curveSign = sign
  const rows = 4
  const data = new Uint8Array(256 * rows * 4)
  const defs = [adv.master, adv.red, adv.green, adv.blue]
  for (let row = 0; row < rows; row++) {
    for (let i = 0; i < 256; i++) {
      const t = i / 255
      const v = sampleCurve(defs[row], t)
      const o = (row * 256 + i) * 4
      data[o] = Math.max(0, Math.min(255, Math.round(v * 255)))
      data[o + 3] = 255
    }
  }
  if (!curveTex) curveTex = gl.createTexture()
  gl.bindTexture(gl.TEXTURE_2D, curveTex)
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, data)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
  gl.uniform1i(uniformLoc.uCurves!, 1)
}

function ensureCube(adv: ColorAdvanced): void {
  if (!gl || !program) return
  const path = adv.lutPath ?? ''
  const strength = adv.lutStrength ?? 1
  const on = path && strength > 0.01 ? 1 : 0
  gl.uniform1f(uniformLoc.uCubeOn!, on)
  if (!on) return
  void lutForPath(path).then((lut) => {
    if (!gl || !program || !lut || path !== cubePathInFlight) return
    if (cubePath !== path) {
      cubePath = path
      if (!cubeTex) cubeTex = gl.createTexture()
      gl.bindTexture(gl.TEXTURE_3D, cubeTex)
      gl.uniform1i(uniformLoc.uCube!, 2)
      gl.uniform1f(uniformLoc.uCubeSize!, lut.size)
      gl.texImage3D(
        gl.TEXTURE_3D,
        0,
        gl.RGB16F,
        lut.size,
        lut.size,
        lut.size,
        0,
        gl.RGB,
        gl.FLOAT,
        lut.data
      )
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE)
    }
  })
}
/**
 * Apply the advanced grade to a source crop and return the graded canvas.
 * `sx/sy/sw/sh` select the source region (pixels). Synchronous call; the
 * .cube texture is uploaded asynchronously on first use.
 */
export function colorGrade(
  image: CanvasImageSource,
  sx: number,
  sy: number,
  sw: number,
  sh: number,
  adv: ColorAdvanced
): HTMLCanvasElement | null {
  if (!adv?.enabled || !initGL() || !gl || !program) return null
  const ctx = gl as WebGL2RenderingContext
  const w = Math.max(1, Math.round(sw))
  const h = Math.max(1, Math.round(sh))
  if (glCanvas!.width !== w || glCanvas!.height !== h) {
    glCanvas!.width = w
    glCanvas!.height = h
  }
  ctx.useProgram(program)
  ctx.bindVertexArray(vao)
  ctx.viewport(0, 0, w, h)

  // Source texture (flip Y so downstream drawImage keeps orientation).
  if (!srcTex) srcTex = ctx.createTexture()
  ctx.activeTexture(ctx.TEXTURE0)
  ctx.bindTexture(ctx.TEXTURE_2D, srcTex)
  ctx.pixelStorei(ctx.UNPACK_FLIP_Y_WEBGL, true)
  try {
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MIN_FILTER, ctx.LINEAR)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_MAG_FILTER, ctx.LINEAR)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_S, ctx.CLAMP_TO_EDGE)
    ctx.texParameteri(ctx.TEXTURE_2D, ctx.TEXTURE_WRAP_T, ctx.CLAMP_TO_EDGE)
    ctx.texImage2D(ctx.TEXTURE_2D, 0, ctx.RGBA, ctx.RGBA, ctx.UNSIGNED_BYTE, image as TexImageSource)
  } catch {
    return null
  }
  ctx.uniform1i(uniformLoc.uSrc!, 0)

  // Curves.
  ctx.activeTexture(ctx.TEXTURE1)
  ensureCurves(adv)
  const has = (pts?: CurvePoint[] | null) => (pts && pts.length > 0 ? 1 : 0)
  ctx.uniform1f(uniformLoc.uCurveMasterOn!, has(adv.master))
  ctx.uniform3f(
    uniformLoc.uChanOn!,
    has(adv.red),
    has(adv.green),
    has(adv.blue)
  )

  // Wheels.
  const wheel = (v: unknown): [number, number, number] => {
    if (Array.isArray(v) && v.length === 3) return v as [number, number, number]
    return [0, 0, 0]
  }
  const lift = wheel(adv.lift)
  const gamma = wheel(adv.gamma)
  const gain = wheel(adv.gainWheel)
  ctx.uniform3f(uniformLoc.uLift!, lift[0] * 0.12, lift[1] * 0.12, lift[2] * 0.12)
  ctx.uniform3f(uniformLoc.uGamma!, gamma[0] * 0.12, gamma[1] * 0.12, gamma[2] * 0.12)
  ctx.uniform3f(uniformLoc.uGainWheel!, gain[0] * 0.16, gain[1] * 0.16, gain[2] * 0.16)

  // Cube LUT (async upload on first request).
  cubePathInFlight = adv.lutPath ?? ''
  ctx.activeTexture(ctx.TEXTURE2)
  ensureCube(adv)

  ctx.drawArrays(ctx.TRIANGLES, 0, 3)
  return glCanvas!
}
