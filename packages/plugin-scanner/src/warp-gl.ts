/**
 * `@xcwds/plugin-scanner/warp-gl`: `warp` on the GPU, with WebGL 2, in a Worker (on an
 * `OffscreenCanvas`) or on the page. It samples exactly as `warp` does, so the two give the same
 * page to within a shade, and it gives `null` wherever it can't run, for `warp` to do the work
 * instead. Safe to import anywhere: the GPU is reached only when a page is warped.
 */
import type { Quad } from './geometry.js';
import { warpMatrix, type Pixels } from './warp.js';

export interface WarpGlOptions {
	/**
	 * Makes the canvas to draw with, or `null` for none. The default is an `OffscreenCanvas`, else
	 * a `<canvas>` where there's a document.
	 */
	canvas?: () => OffscreenCanvas | HTMLCanvasElement | null;
}

/**
 * The most output pixels drawn at once. The page is drawn in strips of rows, so the GPU never
 * holds more than this (16 MB) besides the photo, and no single draw runs long enough for the
 * browser to give up on the GPU.
 */
export const STRIP_PIXELS = 1 << 22;

const VERTEX = `#version 300 es
in vec2 corner;
void main() { gl_Position = vec4(corner, 0.0, 1.0); }`;

// `warp`'s loop, per output pixel: gl_FragCoord is the pixel's centre, the strip starts `row`
// rows down the page, and the four texels are mixed by hand (texelFetch), not by the GPU's
// filtering, whose weights some GPUs round to 1/256.
const FRAGMENT = `#version 300 es
precision highp float;
precision highp int;
uniform highp sampler2D source;
uniform mat3 toSource;
uniform float row;
out vec4 colour;
void main() {
	ivec2 last = textureSize(source, 0) - 1;
	vec3 p = toSource * vec3(gl_FragCoord.x, gl_FragCoord.y + row, 1.0);
	vec2 s = clamp(p.xy / p.z - 0.5, vec2(0.0), vec2(last));
	ivec2 a = ivec2(floor(s));
	ivec2 b = min(a + 1, last);
	vec2 f = s - vec2(a);
	vec4 above = mix(texelFetch(source, a, 0), texelFetch(source, ivec2(b.x, a.y), 0), f.x);
	vec4 below = mix(texelFetch(source, ivec2(a.x, b.y), 0), texelFetch(source, b, 0), f.x);
	colour = mix(above, below, f.y);
}`;

function defaultCanvas(): OffscreenCanvas | HTMLCanvasElement | null {
	if (typeof OffscreenCanvas === 'function') return new OffscreenCanvas(1, 1);
	if (typeof document === 'object') return document.createElement('canvas');
	return null;
}

/**
 * `warp(source, quad, size)` on the GPU: the same straightened page, or `null` where WebGL 2
 * isn't available, the photo or page is larger than this GPU's textures, or the GPU fails (the
 * context is lost, a shader doesn't compile). Throws the `RangeError`s `warp` throws, before
 * anything reaches the GPU.
 */
export function warpGl(
	source: Pixels,
	quad: Quad,
	size: { width: number; height: number },
	options: WarpGlOptions = {}
): Pixels | null {
	const m = warpMatrix(source, quad, size);
	const { width, height } = size;
	let gl: WebGL2RenderingContext | null = null;
	try {
		const canvas = (options.canvas ?? defaultCanvas)();
		gl = (canvas?.getContext('webgl2', {
			alpha: true,
			antialias: false,
			depth: false,
			stencil: false,
			premultipliedAlpha: false,
			preserveDrawingBuffer: false
		}) ?? null) as WebGL2RenderingContext | null;
		if (!gl) return null;
		return draw(gl, source, m, width, height);
	} catch {
		return null;
	} finally {
		// One context a page, given back at once: browsers keep only a few alive.
		gl?.getExtension('WEBGL_lose_context')?.loseContext();
	}
}

function draw(
	gl: WebGL2RenderingContext,
	source: Pixels,
	m: readonly number[],
	width: number,
	height: number
): Pixels | null {
	const rows = Math.max(1, Math.min(height, Math.floor(STRIP_PIXELS / width)));
	const textures = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
	const viewport = gl.getParameter(gl.MAX_VIEWPORT_DIMS) as Int32Array;
	if (
		Math.max(source.width, source.height) > textures ||
		width > Math.min(textures, viewport[0]!) ||
		rows > Math.min(textures, viewport[1]!)
	)
		return null;

	const program = link(gl);
	if (!program) return null;
	gl.useProgram(program);

	const corners = gl.createBuffer();
	gl.bindBuffer(gl.ARRAY_BUFFER, corners);
	// One triangle that covers the whole strip.
	gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
	gl.enableVertexAttribArray(0);
	gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

	// The photo, row 0 first, so texel (x, y) is pixel (x, y).
	const photo = gl.createTexture();
	gl.activeTexture(gl.TEXTURE0);
	gl.bindTexture(gl.TEXTURE_2D, photo);
	gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
	gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	gl.texImage2D(
		gl.TEXTURE_2D,
		0,
		gl.RGBA8,
		source.width,
		source.height,
		0,
		gl.RGBA,
		gl.UNSIGNED_BYTE,
		new Uint8Array(source.data.buffer, source.data.byteOffset, source.data.length)
	);
	gl.uniform1i(gl.getUniformLocation(program, 'source'), 0);
	// `m` is in row order; WebGL 2 transposes it into GLSL's column order.
	gl.uniformMatrix3fv(gl.getUniformLocation(program, 'toSource'), true, m as number[]);
	const row = gl.getUniformLocation(program, 'row');

	// Each strip is drawn into its own texture, row 0 at the bottom of the framebuffer, which is
	// where readPixels starts: so the strip reads out top row first, as `Pixels` are.
	const strip = gl.createTexture();
	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, strip);
	gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, width, rows);
	const framebuffer = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, strip, 0);
	if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) return null;
	gl.disable(gl.BLEND);
	gl.disable(gl.DITHER);

	const out = new Uint8ClampedArray(width * height * 4);
	gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
	for (let top = 0; top < height; top += rows) {
		const count = Math.min(rows, height - top);
		gl.viewport(0, 0, width, count);
		gl.uniform1f(row, top);
		gl.drawArrays(gl.TRIANGLES, 0, 3);
		gl.readPixels(
			0,
			0,
			width,
			count,
			gl.RGBA,
			gl.UNSIGNED_BYTE,
			new Uint8Array(out.buffer, top * width * 4, count * width * 4)
		);
	}
	if (gl.getError() !== gl.NO_ERROR || gl.isContextLost()) return null;
	return { width, height, data: out };
}

function link(gl: WebGL2RenderingContext): WebGLProgram | null {
	const program = gl.createProgram();
	for (const [type, text] of [
		[gl.VERTEX_SHADER, VERTEX],
		[gl.FRAGMENT_SHADER, FRAGMENT]
	] as const) {
		const shader = gl.createShader(type);
		if (!shader) return null;
		gl.shaderSource(shader, text);
		gl.compileShader(shader);
		gl.attachShader(program, shader);
	}
	gl.bindAttribLocation(program, 0, 'corner');
	gl.linkProgram(program);
	return gl.getProgramParameter(program, gl.LINK_STATUS) ? program : null;
}
