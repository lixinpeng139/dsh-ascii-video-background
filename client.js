/**
 * dsh-ascii-video-background — browser half.
 *
 * A full-window character-video backdrop, plus its Settings section. The
 * renderer is a browser reimplementation of the ASCII-Video pipeline:
 * the same printable-ASCII ink ordering, gamma curve, colour transform and
 * per-cell glyph atlas, applied to a <video> at a deliberately small grid.
 *
 * Video bytes live in the Host attachment store; this module only keeps the
 * attachment reference and presentation preferences in localStorage. It
 * imports no Harness Client package beyond the browser module table.
 */

window.__ModuleLoader__.load({
  id: 'dsh-ascii-video-background',
  factory: (require) => {
    const React = require('react')
    const ReactDOM = require('react-dom')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'ascii-video-background'
    const SETTINGS_ID = 'ascii-video-background'
    const STORAGE_KEY = 'dsh.ascii-video-background.v1'
    const API_ROOT = '/api/ascii-video-background'
    const UPLOAD_URL = `${API_ROOT}/upload`
    const MEDIA_PATH = `${API_ROOT}/media`
    const DEFAULT_MEDIA_PATH = `${API_ROOT}/default`
    const STATE_URL = `${API_ROOT}/state`
    const MAX_BYTES = 512 * 1024 * 1024
    const MAX_VIDEOS = 50
    const MAX_CELLS = 32000
    const P = 'avb'
    let accessToken = window.__DSH_ASCII_VIDEO_BACKGROUND_TOKEN__ || ''
    let tokenPromise = null
    const tokenListeners = new Set()

    function publishToken(value) {
      accessToken = value
      for (const listener of tokenListeners) {
        try {
          listener(value)
        } catch {
          // A hook that unmounted mid-notify must not stop the others.
        }
      }
    }

    /**
     * The Host injects the capability into the page, but an HMR-loaded module
     * may start without it. Resource routes sit behind the SPA cookie gate, so
     * this small authenticated read is the fallback.
     */
    function ensureToken() {
      if (accessToken !== '') return Promise.resolve(accessToken)
      if (tokenPromise !== null) return tokenPromise
      tokenPromise = fetch(`${API_ROOT}/token`, {
        credentials: 'same-origin',
        cache: 'no-store',
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(`token request failed (${response.status})`)
          const body = await response.json()
          if (body === null || typeof body.token !== 'string' || body.token === '') {
            throw new Error('token response is invalid')
          }
          publishToken(body.token)
          return body.token
        })
        .catch((error) => {
          tokenPromise = null
          throw error
        })
      return tokenPromise
    }

    /**
     * Uploads always ask the current Host for its token first: the page may
     * have been open across a Host restart, where the old injected token is no
     * longer valid. If that read fails, keep the previously known token so a
     * normal page can still use its earlier injection.
     */
    function refreshToken() {
      const previous = accessToken
      accessToken = ''
      tokenPromise = null
      return ensureToken().catch((error) => {
        if (previous !== '') {
          accessToken = previous
          return previous
        }
        throw error
      })
    }

    function useAccessToken() {
      const [token, setToken] = useState(accessToken)
      useEffect(() => {
        tokenListeners.add(setToken)
        if (accessToken !== '') setToken(accessToken)
        else ensureToken().catch(() => {})
        return () => {
          tokenListeners.delete(setToken)
        }
      }, [])
      return token
    }

    // === ASCII RENDERER START ===

    /**
     * Printable ASCII glyphs from the ASCII-Video embedded DejaVu Sans Mono
     * 16x32 bitmap, in its original code-point order. Two bytes per row, little
     * endian, matching the C source's uint16_t table.
     */
    const FONT_B64 = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIABgAGAAYABgAGAAYABgAGAAYABgAGAAYABAAAAAAAAgAGAAYABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwDnAOcA5wDnAOcA5wDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAGMAxwDGAMYAxgH/3//PzAGMA5wDGAM/P/8/+AYwBjAGMA4wDEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAIAAgADgA/gPmByAGIA4gDiAHIAf8A/4AZwAjACMAIwAnDD4P/APgAGAAIAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA+AH8AY4DBgMEAYw5/PD7gAYAHeDz+cMYAggGDAYYB/gB8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAB4A/gDwAcABgAGAAcAAwADgAfgjuHccZh5mB2YH5gPHAccHw87h+ABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIABgAGAAYABgAGAAYABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAYADgAMAAwAGAAYABgAOAAwADAAMAAwAHAAMAAwADAAOAA4ADgAGAAcAAwABgAGAAAAAAAAAAAAAAAAAAAAAAAAAGAAYAA4ADgAGAAcABwAHAAMAAwADAAMAAwADAAMAAwAHAAYABgAMAAwADAAYABgAAAAAAAAAAAAAAAAAAAAAAAIABgAGMMbgd4AfAA+AHuB2MMYABgAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIABgAGAAYABgAGAAf5//n+AAYABgAGAAYABgAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAHAA8ADwAOAA4ADAAMABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgB+AHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAA8ADwAPAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAYADgAMABwAGAA4ADAAMABwAGAAYADAAMABwAGAA4ADAAcABgAOAAwADAAAAAAAAAAAAAAAAAAAAAAAAAAAeAH8A84HBgYHDgcOBw4HDCMMcwzzDMMMBw4HDgcOBg4OBxwHvAPwAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAB8AfwB3AAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAA/A/8HwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4B/wPzgwGAAcABwAGAA4ADgAcADgAMABgAMABwAOAAwAHPw//D8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeA/8D84ABgAHAAYADgAcADgB/AHOAAcABwAHAAcABwAOAB4OPA/wA8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAPAA8AHwAXADcANwBnAMcAxwGHA4cDD8f/5//D9wAHAAcABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8B/wHwAYABgAGAAYABngH/AfOAAYABwAHAAcABwAHAA4APA44D+ADwAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAPgH+A8AHAAYADgAOMAx8Dd4Phw8HDgMOAw4DDgMOBw4HBx4HvAPwAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8P/w/GAA4ADgAMABwAHAA4ADgAMAAwAHAAYABgAOAAwAHAAcABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAB8A/4HzgcHDgcOBw4GBg4HOAP8A84HBw4HDgMMAwwHDgcOHge8A/AAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAeAP8B84OBg4HDAcMBwwHDAcODw4fBzsH8wHHAAcABgAOADwGOAfgAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAHAA8ADwAOAAQAAAAAAAAAAAACAA8ADwAPAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIABwAPAA8ADgAEAAAAAAAAAAAAAwAHAA8ADwAOAA4ADAAMABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAD4A+AHgBwA/AHgAeAA/4Af4AT4ADgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP5//n/8PwAAAAD8P/5//n8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABwAHyAH+AH/AAeAB4A/ADgB4AfAHwAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAfAP+B84EBgAGAA4ADgAcADgAMABgAGAA4ADgAMAAAAAgAOAA4ADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAB+AccHg4YBjAmcP5hnmMGYwbDBsYGxgbHBsOOY/5h8mAAMAA4ABwID/gDIAAAAAAAAAAAAAAAAAAAAAAAwAPAA8AD4AdgBmAGcA5wDjAMOBw4HBgY+B/8PxwwDDAOcA5wBmAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOA/+D84OBw4HDgcOBw4ODjwP/A/PDgcOA44DjgOOA44HDj4P/A/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAD8A/wPBA4AHAAYADgAOAA4ADgAOAA4ADgAOAA4ADgAHAQcHA/8B/ABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgD/gP3AwODAcMBwwHDAcMBwwDDAMMBwwHDAcMBwwODB4MPA/wD8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwf/B8AGAAYABgAGAAYABj8H/wfABgAGAAYABgAGAAYABj8H/wfAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8H/wfABwAHAAcABwAHAAc/B/4HwAcABwAHAAcABwAHAAcABwAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAA+Af8DwwcABgAOAA4ADAAcABwfHB8cHxwDDAMMAw4DDgMHBwP/AfgAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwwDDAMMAwwDDAMMAwwHDj8P/w/DDAMMAwwDDAMMAwwDDAMMAwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAD4H/gfgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYAB+B/4HwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AfwBzAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAcABwYPB44D+ADwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4wHDA4MHAw4DDAMYAzgDeAP4A/wD3gOOAwcDA4MDgwHDAOMA4wAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAY/h/+HwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHngeeD54Pnw+fG52bnZuds5zznPOc45xDnAOcA5wDnAOcA5wDnAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAw4DDwMPAw+DD4MNgwzDDOMM4wxjDHMMMww7DBsMHwwPDA8MBwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAgAHgB/AfOBwcOBw4HDgMMAwwDDAMcAwwDDAMMBw4HDgcODgceB7wD8ADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4B/4HzwYHBgOGA4YDhgOGBwY/B/4H4AfABgAGAAYABgAGAAYABgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAeAH8B84HBw4HDgcOAwwDDAMMAxwDDAMMAwwHDgcOBw4OBx4HvAP4ANwADgAEAAAAAAAAAAAAAAAAAAAAAAAAADAP/A/eDg4OBw4HDgcOBw4ODjwP+A/8DgwODg4HDgcOA44DjgHOAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAB+A/4Hwg4ADgAMAAwADgAPMAf8A/4ATwAHAAMAAwAHAAcIHg88D/ABwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP5//n+AAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcOBw4HDgcOBw4HDgcOBw4HDgcOBw4HDgcOBw4HDgcOBw4eB7wD8ADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADnAOcA5wDDAcOBw4GBg4GDgcMBwwDHAOcA5gBmAG4AfAA8ADwAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfgB+AH4AbgBmCGYcZjzmPOc85zTDZsNmw2bDZ8PDw8PDw4HDgcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOcAw4HBg4HDAOcA5gB+ADwAPAA8AD4AdwDjAOOBwYGBw4DnAOcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADnAOcBw4GDg4HDAMcA7gBuAHwAOAAYABgAGAAYABgAGAAYABgAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP4//j8eABwAOAA4AHAA4ADgAMABgAOAAwAHAA4ADgAcADj+P/4/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8APgAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAPwA+ADAAAAAAAAAAAAAAAAAAAAAAAAADAAOAA4ABgAHAAMAA4ABgAHAAOAA4ABwAHAAOAAYABwAHAAMAA4ABgAHAAAAAAAAAAAAAAAAAAAAAAAAADAD8AHwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAPwAcAAAAAAAAAAAAAAAAAAAAAAADAA8AD4AdwDjgcHDgMMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/////wAAAAAAAAAAAA4ABgADgAGAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAH8B94HBgAHAAcAPwH/B8cOBwwHDAcMDw4/DzcH4AHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA4ADgAOAA4ADjgOfA7OD4cPBw4DDgMOAw4DDgMOAw4HDgcPDg+8DvAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA8AH8BxwPAA4AHAAYABgAGAAYABgAGAAcAA4cD/wH8AEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAHAAcABwAHAAcAJwH3A98HDw4HDgcMBwwHDAcMBwwHDAcODw4fBzcD4AHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAA/APOB4cHAw4DDAMMPw//D8AMAAwADgAGBwe/A/gAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAD8APwBgAGAA4ADgAP8P/gfgAOAA4ADgAOAA4ADgAOAA4ADgAOAA4ADAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIAH3A98HDw4HDgcMBwwHDAcMBwwHDA8ODwc/B/cDxgAGAA4AHAc8B/ABwAAAAAAAAAAAAAAAAA4ADgAOAA4ADjgOfA7OD4YPBw4HDgcOBw4HDgcOBw4HDgcOBw4HDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAYABgAEAAAAAAACAH4APgAGAAYABgAGAAYABgAGAAYABgAH8H/w/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwADAAMAAAAAAAAAAwA/AD8AAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADAAcADgD8AHgAAAAAAAAAAAAAAAAAcABwAHAAcABwAHBwcOBxwHOAcwB2AH8Af4B7gHHAcOBwcHBwcDhwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPwA/AAMAAwADAAMAAwADAAMAAwADAAMAAwADAAMAAwADgAP4AfgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgGfH/Me45xjnGOcY5xjnGOcY5xjnGOcY5xjnGOcQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADgAfA7OD4YPBw4HDgcOBw4HDgcOBw4HDgcOBw4HDgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwAPwD3geGBgcOBw4DDAMMAwwDDAcOBw4GBh4HvAPwAMAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAB8Ds4Phw8HDgMOAw4DDgMOAw4DDgcOBw8OD7wO8A5ADgAOAA4ADgAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAA/wPfB48GBw4HDgcMBwwHDAcMBw4HDg8GHwe/A+cAxwAHAAcABwAHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPAD+BsYHgAcABwAGAAYABgAGAAYABgAGAAYABgAGAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAOAD+A84HgAYABgAHAAe4A/wA3gAGAAYABgAeBzwH8AHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAwADAAMAB/g/+D8AAwADAAMAAwADAAMAAwADAAMAA/gD+AEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcOBw4HDgcOBw4HDgcOBw4HDgcGBwYPBh8HtwPgAcAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADDAMMBw4GBgYGDgcMAxwDHAOYAbgB+AHwAPAAwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAfgB+AGYAZghmGOccwzzDNMMnw2eD54HDgcOBwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAcODgYMAxwDuAHwAPAA8AD4AdgBnAOOBwcOAwwAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADjAMOBw4GBgYHDgMMAxwDnAGYAfgA8ADwAPAAYABgAMAAwAHAD4AHAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAPgf+B84AHAAYADgAMABgAMABwAHAA4AHPgf+B8AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAB4APgBwAGAAYABgAGAAYABgAGAAYADAB8AHoAHgAOAAYABgAGAAYABgAHAAcAB+AAYAAAAAAAAAAAAAAAAAAAAgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABgAGAAYABAAAAAAAAAAAAAAAeAB+AA4ABgAGAAYABgAGAAYABwAH4AHgA4AGAAYABgAGAAYABgAGAAYADgAcAHwAYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAIf/n/+YXgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    const GLYPH_COUNT = 95
    const FONT_W = 16
    const FONT_H = 32
    let FONT_BITS = null

    function fontBits() {
      if (FONT_BITS !== null) return FONT_BITS
      const binary = atob(FONT_B64)
      const bits = new Uint16Array(GLYPH_COUNT * FONT_H)
      for (let i = 0; i < bits.length; i += 1) {
        bits[i] = binary.charCodeAt(i * 2) | (binary.charCodeAt(i * 2 + 1) << 8)
      }
      FONT_BITS = bits
      return bits
    }

    /** The source bitmap's row bits are high-bit-left. */
    function fontBit(bits, glyph, x, y) {
      return (bits[glyph * FONT_H + y] >> (FONT_W - 1 - x)) & 1
    }

    /**
     * Average the 16x32 bitmap over one destination pixel's source rectangle,
     * mirroring ASCII-Video's area sampler for downscaled glyph cells.
     */
    function areaMask(bits, glyph, x, y, cellW, cellH) {
      const x0 = (x * FONT_W) / cellW
      const x1 = ((x + 1) * FONT_W) / cellW
      const y0 = (y * FONT_H) / cellH
      const y1 = ((y + 1) * FONT_H) / cellH
      let sum = 0
      let weight = 0
      for (let sy = Math.floor(y0); sy < Math.ceil(y1); sy += 1) {
        const wy = Math.min(y1, sy + 1) - Math.max(y0, sy)
        if (wy <= 0) continue
        for (let sx = Math.floor(x0); sx < Math.ceil(x1); sx += 1) {
          const wx = Math.min(x1, sx + 1) - Math.max(x0, sx)
          if (wx <= 0) continue
          sum += wx * wy * fontBit(bits, glyph, sx, sy)
          weight += wx * wy
        }
      }
      return weight > 0 ? Math.min(255, Math.round((sum / weight) * 255)) : 0
    }

    /**
     * Glyph brightness curve. ASCII-Video uses 0.55, which deliberately lifts
     * shadows for full-screen viewing. A wallpaper must leave the UI's text and
     * surfaces readable, so this variant raises the exponent to keep near-black
     * video areas empty while bright subjects still reach the dense glyphs.
     */
    const GAMMA = new Uint8Array(256)
    for (let i = 0; i < 256; i += 1) {
      GAMMA[i] = Math.max(0, Math.min(255, Math.round(Math.pow(i / 255, 1.6) * 255)))
    }

    /**
     * Build the sorted glyph atlas and 256-entry brightness-to-glyph table for
     * one cell size. This is the same ink sort, stable ordering, and nearest
     * normalised-ink lookup as the C renderer.
     */
    function buildAtlas(cellW, cellH) {
      const bits = fontBits()
      const size = cellW * cellH
      const raw = new Uint8Array(GLYPH_COUNT * size)
      const ink = new Float64Array(GLYPH_COUNT)
      const order = new Uint16Array(GLYPH_COUNT)

      for (let glyph = 0; glyph < GLYPH_COUNT; glyph += 1) {
        let total = 0
        const base = glyph * size
        for (let y = 0; y < cellH; y += 1) {
          for (let x = 0; x < cellW; x += 1) {
            const value = areaMask(bits, glyph, x, y, cellW, cellH)
            raw[base + y * cellW + x] = value
            total += value
          }
        }
        ink[glyph] = total / (size * 255)
        order[glyph] = glyph
      }

      // Stable insertion sort, as in atlas_sort: equal ink keeps ASCII order.
      for (let i = 1; i < GLYPH_COUNT; i += 1) {
        const key = order[i]
        let j = i - 1
        while (j >= 0 && ink[order[j]] > ink[key]) {
          order[j + 1] = order[j]
          j -= 1
        }
        order[j + 1] = key
      }

      const minimum = ink[order[0]]
      const maximum = ink[order[GLYPH_COUNT - 1]]
      const masks = new Uint8Array(GLYPH_COUNT * size)
      const norm = new Float64Array(GLYPH_COUNT)
      const chars = new Array(GLYPH_COUNT)
      for (let i = 0; i < GLYPH_COUNT; i += 1) {
        const glyph = order[i]
        masks.set(raw.subarray(glyph * size, glyph * size + size), i * size)
        chars[i] = String.fromCharCode(32 + glyph)
        norm[i] = maximum - minimum > 1e-9 ? (ink[glyph] - minimum) / (maximum - minimum) : 0
      }

      const lut = new Uint8Array(256)
      for (let value = 0; value < 256; value += 1) {
        const target = value / 255
        let low = 0
        let high = GLYPH_COUNT
        while (low < high) {
          const mid = (low + high) >> 1
          if (norm[mid] < target) low = mid + 1
          else high = mid
        }
        if (low >= GLYPH_COUNT) low = GLYPH_COUNT - 1
        if (low > 0 && target - norm[low - 1] < norm[low] - target) low -= 1
        lut[value] = low
      }

      const atlas = document.createElement('canvas')
      atlas.width = GLYPH_COUNT * cellW
      atlas.height = cellH
      const context = atlas.getContext('2d')
      const image = context.createImageData(atlas.width, atlas.height)
      for (let glyph = 0; glyph < GLYPH_COUNT; glyph += 1) {
        for (let i = 0; i < size; i += 1) {
          const px = glyph * cellW + (i % cellW)
          const py = Math.floor(i / cellW)
          const target = (py * atlas.width + px) * 4
          const alpha = masks[glyph * size + i]
          image.data[target] = 255
          image.data[target + 1] = 255
          image.data[target + 2] = 255
          image.data[target + 3] = alpha
        }
      }
      context.putImageData(image, 0, 0)

      return { cellW, cellH, size, masks, chars, norm, lut, canvas: atlas }
    }

    /**
     * The project's per-cell colour: saturation lift, then a proportional gain
     * toward a minimum bright value so hue survives instead of clipping.
     */
    function originalColor(r, g, b, out) {
      const gray = 0.299 * r + 0.587 * g + 0.114 * b
      let cr = Math.max(0, gray + (r - gray) * 1.35)
      let cg = Math.max(0, gray + (g - gray) * 1.35)
      let cb = Math.max(0, gray + (b - gray) * 1.35)
      const peak = Math.max(cr, cg, cb)
      if (peak < 1) {
        out[0] = 0
        out[1] = 0
        out[2] = 0
        return out
      }
      const target = Math.max(peak * 1.45, Math.min(190, peak * 8))
      const gain = Math.min(target, 255) / peak
      out[0] = Math.min(255, Math.round(cr * gain))
      out[1] = Math.min(255, Math.round(cg * gain))
      out[2] = Math.min(255, Math.round(cb * gain))
      return out
    }

    const TINT_BASE = {
      miku: [126, 255, 96],
      amber: [255, 184, 92],
      mono: [232, 238, 235],
    }

    /** Fixed terminal tints keep the glyph density as the only luminance cue. */
    function tintColor(theme, level, out) {
      const base = TINT_BASE[theme] ?? TINT_BASE.mono
      const k = 0.55 + 0.45 * (level / 255)
      out[0] = Math.round(base[0] * k)
      out[1] = Math.round(base[1] * k)
      out[2] = Math.round(base[2] * k)
      return out
    }

    function clampNumber(value, minimum, maximum, fallback) {
      const number = typeof value === 'number' && Number.isFinite(value) ? value : fallback
      return Math.max(minimum, Math.min(maximum, number))
    }

    /**
     * One character-video surface. WebGL instancing draws the glyph atlas when
     * available; the same atlas is composited through a 2D ImageData fallback
     * when the deployment has no WebGL.
     */
    class AsciiRenderer {
      constructor(canvas, video, options) {
        this.canvas = canvas
        this.video = video
        this.options = {
          cellSize: clampNumber(options.cellSize, 4, 14, 9),
          theme: options.theme || 'original',
          fit: options.fit || 'cover',
          fps: clampNumber(options.fps, 1, 60, 24),
        }
        this.dpr = Math.min(2, window.devicePixelRatio || 1)
        this.grid = null
        this.atlas = null
        this.instanceData = null
        this.imageData = null
        this.ctx2d = null
        this.gl = null
        this.texture = null
        this.program = null
        this.buffers = null
        this.attributes = null
        this.uniforms = null
        this.drawInstanced = null
        this.running = false
        this.raf = 0
        this.lastDraw = 0
        this.frameDrawn = false
        this.sampleCanvas = document.createElement('canvas')
        this.sampleCtx = this.sampleCanvas.getContext('2d', { willReadFrequently: true })
        this.color = [0, 0, 0]
        this.onPlay = () => {
          this.frameDrawn = false
        }
        this.onSeeked = () => {
          this.frameDrawn = false
        }
        this.onVisibility = () => {
          if (document.hidden) this.video.pause()
          else this.video.play().catch(() => {})
        }

        this.video.addEventListener('play', this.onPlay)
        this.video.addEventListener('seeked', this.onSeeked)
        document.addEventListener('visibilitychange', this.onVisibility)
        this.initGL()
        this.resize()
        if (typeof ResizeObserver === 'function') {
          this.observer = new ResizeObserver(() => this.resize())
          this.observer.observe(canvas)
        } else {
          this.onResize = () => this.resize()
          window.addEventListener('resize', this.onResize)
        }
        if (this.gl === null && this.ctx2d === null) {
          throw new Error('neither WebGL nor Canvas 2D is available')
        }
      }

      initGL() {
        const attributes = { alpha: true, antialias: false, depth: false, premultipliedAlpha: false }
        let gl = null
        try {
          gl = this.canvas.getContext('webgl2', attributes) || this.canvas.getContext('webgl', attributes)
        } catch {
          gl = null
        }
        if (gl === null) {
          this.ctx2d = this.canvas.getContext('2d', { alpha: true })
          return
        }

        try {
          const vertex = createShader(gl, gl.VERTEX_SHADER, `
attribute vec2 a_vertex;
attribute vec2 a_cell;
attribute float a_glyph;
attribute vec3 a_color;
uniform vec2 u_cell;
uniform vec2 u_resolution;
varying vec2 v_uv;
varying vec3 v_color;
void main() {
  vec2 pixel = a_cell * u_cell + a_vertex * u_cell;
  vec2 clip = vec2((pixel.x / u_resolution.x) * 2.0 - 1.0,
                   1.0 - (pixel.y / u_resolution.y) * 2.0);
  gl_Position = vec4(clip, 0.0, 1.0);
  v_uv = vec2((a_glyph + a_vertex.x) / 95.0, 1.0 - a_vertex.y);
  v_color = a_color;
}
`)
          const fragment = createShader(gl, gl.FRAGMENT_SHADER, `
precision mediump float;
uniform sampler2D u_atlas;
varying vec2 v_uv;
varying vec3 v_color;
void main() {
  float mask = texture2D(u_atlas, v_uv).a;
  if (mask <= 0.01) discard;
  gl_FragColor = vec4(v_color, mask);
}
`)
          const program = gl.createProgram()
          gl.attachShader(program, vertex)
          gl.attachShader(program, fragment)
          gl.linkProgram(program)
          gl.deleteShader(vertex)
          gl.deleteShader(fragment)
          if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
            throw new Error(gl.getProgramInfoLog(program) || 'link failed')
          }

          const ext = gl.getExtension('ANGLE_instanced_arrays')
          if (typeof gl.drawArraysInstanced !== 'function' && ext === null) {
            throw new Error('instanced arrays unavailable')
          }

          this.gl = gl
          this.program = program
          this.drawInstanced = typeof gl.drawArraysInstanced === 'function'
            ? (count) => gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, count)
            : (count) => ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, count)
          this.attributes = {
            vertex: gl.getAttribLocation(program, 'a_vertex'),
            cell: gl.getAttribLocation(program, 'a_cell'),
            glyph: gl.getAttribLocation(program, 'a_glyph'),
            color: gl.getAttribLocation(program, 'a_color'),
          }
          this.uniforms = {
            cell: gl.getUniformLocation(program, 'u_cell'),
            resolution: gl.getUniformLocation(program, 'u_resolution'),
            atlas: gl.getUniformLocation(program, 'u_atlas'),
          }
          this.buffers = {
            quad: gl.createBuffer(),
            instances: gl.createBuffer(),
          }
          this.gl_instanced = ext
          this.texture = gl.createTexture()
          gl.bindTexture(gl.TEXTURE_2D, this.texture)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
          gl.useProgram(program)
          gl.enable(gl.BLEND)
          gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA)
          gl.disable(gl.DEPTH_TEST)
          gl.clearColor(0, 0, 0, 0)

          gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.quad)
          gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
            0, 0, 1, 0, 0, 1,
            0, 1, 1, 0, 1, 1,
          ]), gl.STATIC_DRAW)
          gl.enableVertexAttribArray(this.attributes.vertex)
          gl.vertexAttribPointer(this.attributes.vertex, 2, gl.FLOAT, false, 0, 0)
          if (this.gl_instanced !== null) this.gl_instanced.vertexAttribDivisorANGLE(this.attributes.vertex, 0)
          else gl.vertexAttribDivisor(this.attributes.vertex, 0)
        } catch (error) {
          this.gl = null
          console.warn('[ascii-video-background] WebGL unavailable, using the 2D fallback', error)
          this.ctx2d = this.canvas.getContext('2d', { alpha: true })
        }
      }

      setOptions(next) {
        const previousCell = this.options.cellSize
        this.options = {
          ...this.options,
          ...next,
          cellSize: clampNumber(next.cellSize, 4, 14, this.options.cellSize),
          fps: clampNumber(next.fps, 1, 60, this.options.fps),
        }
        this.frameDrawn = false
        if (previousCell !== this.options.cellSize) this.resize()
      }

      resize() {
        const rect = this.canvas.getBoundingClientRect()
        const width = Math.max(1, Math.round(rect.width * this.dpr))
        const height = Math.max(1, Math.round(rect.height * this.dpr))
        if (width <= 1 || height <= 1) return

        let cellPx = Math.max(4, Math.min(32, Math.round(this.options.cellSize * this.dpr)))
        let cols = Math.max(1, Math.ceil(width / cellPx))
        let rows = Math.max(1, Math.ceil(height / (cellPx * 2)))
        while (cols * rows > MAX_CELLS && cellPx < 48) {
          cellPx += 1
          cols = Math.max(1, Math.ceil(width / cellPx))
          rows = Math.max(1, Math.ceil(height / (cellPx * 2)))
        }

        const cellChanged = this.grid === null || this.grid.cellPx !== cellPx
        this.grid = { cols, rows, cellPx }
        if (this.canvas.width !== width) this.canvas.width = width
        if (this.canvas.height !== height) this.canvas.height = height

        if (cellChanged) {
          this.atlas = buildAtlas(cellPx, cellPx * 2)
          if (this.gl !== null && this.texture !== null) {
            const gl = this.gl
            gl.bindTexture(gl.TEXTURE_2D, this.texture)
            gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas)
          }
        }

        this.sampleCanvas.width = cols
        this.sampleCanvas.height = rows
        this.sampleCtx.imageSmoothingEnabled = true
        this.instanceData = new Float32Array(cols * rows * 6)

        if (this.gl !== null) {
          this.gl.viewport(0, 0, width, height)
        } else if (this.ctx2d !== null) {
          this.imageData = this.ctx2d.createImageData(width, height)
        }
        this.frameDrawn = false
      }

      start() {
        if (this.running) return
        this.running = true
        const tick = (time) => {
          if (!this.running) return
          this.raf = requestAnimationFrame(tick)
          if (document.hidden) return
          const interval = 1000 / this.options.fps
          if (time - this.lastDraw < interval) return
          if (this.video.paused && this.frameDrawn) return
          this.lastDraw = time
          this.render()
        }
        this.raf = requestAnimationFrame(tick)
      }

      render() {
        const video = this.video
        if (this.grid === null || video.readyState < 2 || video.videoWidth === 0) return
        const { cols, rows } = this.grid
        const context = this.sampleCtx
        const vw = video.videoWidth
        const vh = video.videoHeight
        // The visual grid is cols by 2*rows pixels tall, so the crop aspect is
        // cols / (2 * rows), not the sample buffer's cols / rows.
        const targetAspect = cols / (rows * 2)
        const sourceAspect = vw / vh

        context.imageSmoothingEnabled = true
        context.clearRect(0, 0, cols, rows)
        if (this.options.fit === 'contain') {
          context.fillStyle = '#000'
          context.fillRect(0, 0, cols, rows)
          let dw = cols
          let dh = cols / sourceAspect
          if (dh > rows) {
            dh = rows
            dw = rows * sourceAspect
          }
          context.drawImage(video, 0, 0, vw, vh, (cols - dw) / 2, (rows - dh) / 2, dw, dh)
        } else {
          let sx = 0
          let sy = 0
          let sw = vw
          let sh = vh
          if (sourceAspect > targetAspect) {
            sw = vh * targetAspect
            sx = (vw - sw) / 2
          } else {
            sh = vw / targetAspect
            sy = (vh - sh) / 2
          }
          context.drawImage(video, sx, sy, sw, sh, 0, 0, cols, rows)
        }

        let pixels
        try {
          pixels = context.getImageData(0, 0, cols, rows).data
        } catch {
          return
        }

        const atlas = this.atlas
        const out = this.instanceData
        let offset = 0
        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < cols; x += 1) {
            const source = (y * cols + x) * 4
            const r = pixels[source]
            const g = pixels[source + 1]
            const b = pixels[source + 2]
            const level = Math.max(0, Math.min(255,
              Math.round(0.299 * r + 0.587 * g + 0.114 * b)))
            const glyph = atlas.lut[GAMMA[level]]
            if (this.options.theme === 'original') originalColor(r, g, b, this.color)
            else tintColor(this.options.theme, level, this.color)
            out[offset] = x
            out[offset + 1] = y
            out[offset + 2] = glyph
            // The project lifts dark colours aggressively. Shade them toward
            // black so a dark video does not spray bright noise behind text.
            const shade = 0.45 + 0.55 * (level / 255)
            out[offset + 3] = (this.color[0] / 255) * shade
            out[offset + 4] = (this.color[1] / 255) * shade
            out[offset + 5] = (this.color[2] / 255) * shade
            offset += 6
          }
        }

        if (this.gl !== null) this.drawGL()
        else this.draw2D()
        this.frameDrawn = true
      }

      drawGL() {
        const gl = this.gl
        gl.clear(gl.COLOR_BUFFER_BIT)
        gl.useProgram(this.program)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.buffers.instances)
        gl.bufferData(gl.ARRAY_BUFFER, this.instanceData, gl.DYNAMIC_DRAW)
        const stride = 6 * 4
        gl.enableVertexAttribArray(this.attributes.cell)
        gl.vertexAttribPointer(this.attributes.cell, 2, gl.FLOAT, false, stride, 0)
        gl.enableVertexAttribArray(this.attributes.glyph)
        gl.vertexAttribPointer(this.attributes.glyph, 1, gl.FLOAT, false, stride, 2 * 4)
        gl.enableVertexAttribArray(this.attributes.color)
        gl.vertexAttribPointer(this.attributes.color, 3, gl.FLOAT, false, stride, 3 * 4)
        if (this.gl_instanced !== null) {
          this.gl_instanced.vertexAttribDivisorANGLE(this.attributes.cell, 1)
          this.gl_instanced.vertexAttribDivisorANGLE(this.attributes.glyph, 1)
          this.gl_instanced.vertexAttribDivisorANGLE(this.attributes.color, 1)
        } else {
          gl.vertexAttribDivisor(this.attributes.cell, 1)
          gl.vertexAttribDivisor(this.attributes.glyph, 1)
          gl.vertexAttribDivisor(this.attributes.color, 1)
        }
        gl.activeTexture(gl.TEXTURE0)
        gl.bindTexture(gl.TEXTURE_2D, this.texture)
        gl.uniform1i(this.uniforms.atlas, 0)
        gl.uniform2f(this.uniforms.cell, this.grid.cellPx, this.grid.cellPx * 2)
        gl.uniform2f(this.uniforms.resolution, this.canvas.width, this.canvas.height)
        this.drawInstanced(this.grid.cols * this.grid.rows)
      }

      draw2D() {
        const context = this.ctx2d
        if (context === null || this.imageData === null) return
        const data = this.imageData.data
        data.fill(0)
        const { cols, rows, cellPx } = this.grid
        const atlas = this.atlas
        const cellH = cellPx * 2
        const width = this.canvas.width
        const height = this.canvas.height
        const out = this.instanceData
        let offset = 0
        for (let y = 0; y < rows; y += 1) {
          for (let x = 0; x < cols; x += 1) {
            const glyph = out[offset + 2]
            const cr = out[offset + 3] * 255
            const cg = out[offset + 4] * 255
            const cb = out[offset + 5] * 255
            offset += 6
            const baseX = x * cellPx
            const baseY = y * cellH
            const maskBase = glyph * atlas.size
            for (let gy = 0; gy < cellH; gy += 1) {
              const py = baseY + gy
              if (py >= height) break
              for (let gx = 0; gx < cellPx; gx += 1) {
                const px = baseX + gx
                if (px >= width) break
                const alpha = atlas.masks[maskBase + gy * cellPx + gx]
                if (alpha === 0) continue
                const target = (py * width + px) * 4
                data[target] = cr
                data[target + 1] = cg
                data[target + 2] = cb
                data[target + 3] = alpha
              }
            }
          }
        }
        context.putImageData(this.imageData, 0, 0)
      }

      dispose() {
        this.running = false
        cancelAnimationFrame(this.raf)
        this.video.removeEventListener('play', this.onPlay)
        this.video.removeEventListener('seeked', this.onSeeked)
        document.removeEventListener('visibilitychange', this.onVisibility)
        if (this.observer !== undefined) this.observer.disconnect()
        else window.removeEventListener('resize', this.onResize)
        if (this.gl !== null) {
          const gl = this.gl
          if (this.texture !== null) gl.deleteTexture(this.texture)
          if (this.buffers !== null) {
            gl.deleteBuffer(this.buffers.quad)
            gl.deleteBuffer(this.buffers.instances)
          }
          if (this.program !== null) gl.deleteProgram(this.program)
        }
      }
    }

    function createShader(gl, type, source) {
      const shader = gl.createShader(type)
      gl.shaderSource(shader, source)
      gl.compileShader(shader)
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(shader)
        gl.deleteShader(shader)
        throw new Error(log || 'shader compile failed')
      }
      return shader
    }

    // === ASCII RENDERER END ===

    // === SETTINGS AND UI ===

    const BUILTIN_VIDEO = Object.freeze({
      id: 'builtin-whale-loop',
      name: 'whale-loop.mp4',
      type: 'video/mp4',
      bytes: 22076872,
      addedAt: 0,
      builtin: true,
    })

    const DEFAULT_STATE = Object.freeze({
      version: 1,
      enabled: true,
      activeId: BUILTIN_VIDEO.id,
      cellSize: 9,
      opacity: 0.55,
      theme: 'original',
      fit: 'cover',
      fps: 24,
      videos: [BUILTIN_VIDEO],
    })

    const THEMES = ['original', 'miku', 'amber', 'mono']
    const FITS = ['cover', 'contain']
    const FPS_VALUES = [12, 24, 30, 60]
    const MAX_CELL_SIZE = 12
    const MIN_CELL_SIZE = 4

    const DICTIONARIES = {
      zh: {
        nav: '字符视频背景',
        title: '字符视频背景',
        intro: '选一段视频，实时转换成字符画铺在整个工作区后面。视频只在本机播放与处理。',
        videosTitle: '背景视频',
        videosHint: '支持浏览器能播放的格式，例如 MP4、WebM、MOV。建议使用 10–60 秒的循环片段。',
        addVideo: '添加视频',
        uploading: '正在上传 {percent}%',
        dropHint: '也可以把视频拖到这里',
        emptyTitle: '还没有背景视频',
        emptyHint: '添加一段视频后，它会出现在这里，并立即成为工作区背景。',
        activeBadge: '使用中',
        useVideo: '设为背景',
        remove: '移除',
        removeLabel: '移除 {name}',
        removeHint: '从列表移除；宿主附件存储中的原文件不会被删除',
        enabled: '启用背景',
        enabledHint: '关闭后恢复默认界面背景，视频不会播放。',
        cellSize: '字符大小',
        cellSizeHint: '数值越小字符越密，越接近原片细节。',
        opacity: '背景不透明度',
        opacityHint: '让界面文字保持清晰，建议 50%–85%。',
        theme: '配色',
        themeHint: '“原色”保留视频颜色，其余为终端单色风格。',
        themeOriginal: '原色',
        themeMiku: '葱绿',
        themeAmber: '琥珀',
        themeMono: '冷白',
        fit: '画面适配',
        fitHint: '“铺满”会裁掉边缘，“完整”会保留黑边。',
        fitCover: '铺满',
        fitContain: '完整',
        fps: '渲染帧率',
        fpsHint: '降低帧率可减少占用；24 帧通常足够。',
        preview: '实时预览',
        previewHint: '预览使用与背景相同的渲染器；实际背景会铺满窗口。',
        previewEmpty: '添加并选择一个视频后可预览。',
        storageHint: '视频保存在本机 Harness 附件存储中，文件名和选择记录保存在浏览器里。',
        credit: '字符渲染算法参考 ASCII-Video（Kuimuzion，GPL-3.0）。',
        uploadFailed: '上传失败，请重试。',
        unsupported: '请选择视频文件。',
        tooLarge: '视频超过 512 MB。',
        hostUnavailable: '背景视频服务不可用，请重启 Harness 后再试。',
        storageFailed: '无法保存设置，浏览器存储可能已满。',
        videoLoadError: '视频无法播放，可能编码不受支持。',
        chooseFile: '选择视频文件',
      },
      en: {
        nav: 'ASCII video background',
        title: 'ASCII video background',
        intro: 'Turn a video into a live character drawing behind the whole workspace. Videos play and are processed only on this machine.',
        videosTitle: 'Background videos',
        videosHint: 'Use a format the browser can play, such as MP4, WebM, or MOV. A 10–60 second loop works best.',
        addVideo: 'Add video',
        uploading: 'Uploading {percent}%',
        dropHint: 'You can also drop a video here',
        emptyTitle: 'No background video yet',
        emptyHint: 'Add a video and it will appear here and become the workspace backdrop immediately.',
        activeBadge: 'In use',
        useVideo: 'Use as background',
        remove: 'Remove',
        removeLabel: 'Remove {name}',
        removeHint: 'Remove from this list; the original file stays in the Host attachment store',
        enabled: 'Enable background',
        enabledHint: 'Turning this off restores the normal UI background and stops the video.',
        cellSize: 'Character size',
        cellSizeHint: 'Smaller values pack more characters and preserve more detail.',
        opacity: 'Background opacity',
        opacityHint: 'Keeps interface text legible. 50%–85% is a good range.',
        theme: 'Palette',
        themeHint: 'Original keeps the video’s colours; the others are terminal tints.',
        themeOriginal: 'Original',
        themeMiku: 'Spring green',
        themeAmber: 'Amber',
        themeMono: 'Cool white',
        fit: 'Fit',
        fitHint: 'Cover crops the edges; Contain keeps black bars.',
        fitCover: 'Cover',
        fitContain: 'Contain',
        fps: 'Render rate',
        fpsHint: 'Lower rates reduce load; 24 fps is usually enough.',
        preview: 'Live preview',
        previewHint: 'The preview uses the same renderer as the background; the real backdrop fills the window.',
        previewEmpty: 'Add and select a video to preview it.',
        storageHint: 'Videos live in this Harness installation’s attachment store; names and selection stay in the browser.',
        credit: 'Character rendering follows ASCII-Video by Kuimuzion (GPL-3.0).',
        uploadFailed: 'Upload failed. Please try again.',
        unsupported: 'Choose a video file.',
        tooLarge: 'The video is larger than 512 MB.',
        hostUnavailable: 'The background video service is unavailable. Restart Harness and try again.',
        storageFailed: 'Could not save these settings; browser storage may be full.',
        videoLoadError: 'This video could not be played; its encoding may be unsupported.',
        chooseFile: 'Choose a video file',
      },
    }

    function uid() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID()
      }
      return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
    }

    function isRecord(value) {
      return value !== null && typeof value === 'object' && !Array.isArray(value)
    }

    function normalizeVideo(value) {
      if (!isRecord(value)) return null
      if (typeof value.id !== 'string' || value.id === '') return null
      if (typeof value.name !== 'string' || value.name.trim() === '') return null
      if (value.builtin === true) {
        return {
          id: value.id,
          name: value.name.slice(0, 240),
          type: typeof value.type === 'string' ? value.type : BUILTIN_VIDEO.type,
          bytes: Number.isSafeInteger(value.bytes) && value.bytes >= 0 ? value.bytes : BUILTIN_VIDEO.bytes,
          addedAt: typeof value.addedAt === 'number' ? value.addedAt : 0,
          builtin: true,
        }
      }
      const ref = value.ref
      if (!isRecord(ref)) return null
      if (typeof ref.attachmentId !== 'string' || ref.attachmentId === '') return null
      if (typeof ref.name !== 'string') return null
      if (!Number.isSafeInteger(ref.bytes) || ref.bytes < 0) return null
      return {
        id: value.id,
        name: value.name.slice(0, 240),
        type: typeof value.type === 'string' ? value.type : 'application/octet-stream',
        bytes: ref.bytes,
        addedAt: typeof value.addedAt === 'number' ? value.addedAt : Date.now(),
        ref: { attachmentId: ref.attachmentId, name: ref.name, bytes: ref.bytes },
      }
    }

    function normalizeState(raw) {
      if (!isRecord(raw)) return { ...DEFAULT_STATE }
      const hasExplicitVideos = Array.isArray(raw.videos)
      const videos = hasExplicitVideos
        ? raw.videos.map(normalizeVideo).filter((video) => video !== null).slice(0, MAX_VIDEOS)
        : DEFAULT_STATE.videos.slice()
      const activeId = videos.some((video) => video.id === raw.activeId)
        ? raw.activeId
        : (hasExplicitVideos ? null : (videos[0]?.id ?? null))
      return {
        version: 1,
        enabled: typeof raw.enabled === 'boolean' ? raw.enabled : DEFAULT_STATE.enabled,
        activeId,
        cellSize: clampNumber(raw.cellSize, MIN_CELL_SIZE, MAX_CELL_SIZE, DEFAULT_STATE.cellSize),
        opacity: clampNumber(raw.opacity, 0.1, 1, DEFAULT_STATE.opacity),
        theme: THEMES.includes(raw.theme) ? raw.theme : DEFAULT_STATE.theme,
        fit: FITS.includes(raw.fit) ? raw.fit : DEFAULT_STATE.fit,
        fps: FPS_VALUES.includes(raw.fps) ? raw.fps : DEFAULT_STATE.fps,
        videos,
      }
    }

    let storage = null
    try {
      storage = window.localStorage
    } catch {
      storage = null
    }

    function loadState() {
      if (storage === null) return { ...DEFAULT_STATE }
      try {
        const raw = storage.getItem(STORAGE_KEY)
        if (raw === null) return { ...DEFAULT_STATE }
        return normalizeState(JSON.parse(raw))
      } catch {
        return { ...DEFAULT_STATE }
      }
    }

    let currentState = loadState()
    const stateListeners = new Set()
    let stateHydrated = false
    let saveTimer = null
    let pendingSave = false

    function getState() {
      return currentState
    }

    function notifyState() {
      for (const listener of stateListeners) {
        try {
          listener()
        } catch {
          // A consumer that unmounted mid-notify must not stop the others.
        }
      }
    }

    function subscribeState(listener) {
      stateListeners.add(listener)
      return () => {
        stateListeners.delete(listener)
      }
    }

    async function saveStateNow() {
      if (!stateHydrated) {
        pendingSave = true
        return
      }
      try {
        await ensureToken()
        const response = await fetch(STATE_URL, {
          method: 'PUT',
          credentials: 'same-origin',
          cache: 'no-store',
          headers: {
            'content-type': 'application/json',
            'x-avb-token': accessToken,
          },
          body: JSON.stringify(currentState),
        })
        if (!response.ok) throw new Error(`state save failed (${response.status})`)
        pendingSave = false
      } catch (error) {
        console.warn('[ascii-video-background] state save failed', error)
      }
    }

    function scheduleStateSave() {
      if (saveTimer !== null) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => {
        saveTimer = null
        saveStateNow()
      }, 120)
    }

    /**
     * Host metadata is authoritative because the Web GUI port — and therefore
     * localStorage's origin — changes across Harness launches. The local cache
     * still gives an immediate first paint and is uploaded if the Host has no
     * state yet.
     */
    async function bootstrapState() {
      const cached = loadState()
      let remote = null
      try {
        await ensureToken()
        const response = await fetch(STATE_URL, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: accessToken === '' ? {} : { 'x-avb-token': accessToken },
        })
        if (response.ok) {
          const body = await response.json()
          if (body !== null && typeof body === 'object' && body.state !== null) {
            remote = normalizeState(body.state)
          }
        }
      } catch (error) {
        console.warn('[ascii-video-background] state read failed', error)
      }

      if (remote !== null && remote.videos.length > 0) {
        currentState = remote
      } else if (cached.videos.length > 0) {
        currentState = cached
        pendingSave = true
      } else {
        currentState = remote ?? cached
      }
      stateHydrated = true
      notifyState()
      if (pendingSave) {
        pendingSave = false
        await saveStateNow()
      }
    }

    function commitState(mutator) {
      const next = normalizeState(mutator(currentState))
      currentState = next
      if (storage !== null) {
        try {
          storage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch {
          // The Host state file remains authoritative.
        }
      }
      notifyState()
      scheduleStateSave()
      return true
    }

    function videoUrl(video) {
      if (video.builtin === true) {
        return DEFAULT_MEDIA_PATH
      }
      const json = JSON.stringify({ ref: video.ref, type: video.type })
      const bytes = new TextEncoder().encode(json)
      let binary = ''
      for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i])
      const token = btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      return `${MEDIA_PATH}?media=${token}&token=${encodeURIComponent(accessToken)}`
    }

    function formatBytes(bytes) {
      if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    function uploadVideo(file, onProgress) {
      return new Promise((resolve, reject) => {
        const request = new XMLHttpRequest()
        request.open('POST', UPLOAD_URL)
        request.responseType = 'json'
        request.setRequestHeader('content-type', file.type || 'application/octet-stream')
        request.setRequestHeader('x-file-name', encodeURIComponent(file.name))
        if (accessToken !== '') request.setRequestHeader('x-avb-token', accessToken)
        request.upload.addEventListener('progress', (event) => {
          if (event.lengthComputable && event.total > 0) onProgress(event.loaded / event.total)
        })
        request.addEventListener('load', () => {
          const body = request.response
          if (request.status >= 200 && request.status < 300 && isRecord(body) && body.ok === true) {
            resolve(body)
            return
          }
          const error = new Error(isRecord(body) && typeof body.error === 'string' ? body.error : 'upload-failed')
          error.status = request.status
          reject(error)
        })
        request.addEventListener('error', () => reject(new Error('network')))
        request.addEventListener('abort', () => reject(new Error('aborted')))
        request.send(file)
      })
    }

    function useSettingsState() {
      const [snapshot, setSnapshot] = useState(getState)
      useEffect(() => subscribeState(() => setSnapshot(getState())), [])
      useEffect(() => {
        const onStorage = (event) => {
          if (event.key !== null && event.key !== STORAGE_KEY) return
          currentState = loadState()
          for (const listener of stateListeners) {
            try {
              listener()
            } catch {
              // Ignore individual subscriber failures.
            }
          }
        }
        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
      }, [])
      return snapshot
    }

    function PlusIcon({ size = 14 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', xmlns: 'http://www.w3.org/2000/svg',
      },
      h('path', { d: 'M8 2.5V13.5M2.5 8H13.5', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }))
    }

    function TrashIcon({ size = 14 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', xmlns: 'http://www.w3.org/2000/svg',
        strokeWidth: 1, stroke: 'currentColor', strokeLinecap: 'round', strokeLinejoin: 'round',
      },
      h('path', { d: 'M2.5 4.5h11M6 4.5V3h4v1.5M3.5 4.5l.7 9h7.6l.7-9M6.5 7.5v4M9.5 7.5v4' }))
    }

    function CheckIcon({ size = 12 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', xmlns: 'http://www.w3.org/2000/svg',
      },
      h('path', { d: 'm3 8.5 3.2 3.2L13 4.8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round', strokeLinejoin: 'round' }))
    }

    function FilmIcon({ size = 28 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 32 32', fill: 'none',
        'aria-hidden': 'true', xmlns: 'http://www.w3.org/2000/svg',
      },
      h('rect', { x: 3.5, y: 6.5, width: 25, height: 19, rx: 4, stroke: 'currentColor', strokeWidth: 1.4 }),
      h('path', { d: 'M13.5 11.5l7 4.5-7 4.5z', fill: 'currentColor' }),
      h('path', { d: 'M7 6.5v19M25 6.5v19', stroke: 'currentColor', strokeWidth: 1.2, opacity: 0.55 }))
    }

    function SettingsIcon({ size = 16 }) {
      return h('svg', {
        width: size, height: size, viewBox: '0 0 16 16', fill: 'none',
        'aria-hidden': 'true', xmlns: 'http://www.w3.org/2000/svg',
      },
      h('rect', { x: 1.5, y: 2.5, width: 13, height: 11, rx: 2.5, stroke: 'currentColor', strokeWidth: 1.1 }),
      h('path', { d: 'M4 6.2h2.1M4 8h1.2M4 9.8h2.1', stroke: 'currentColor', strokeWidth: 1.1, strokeLinecap: 'round' }),
      h('path', { d: 'M8.2 6.1l3.4 1.9-3.4 1.9z', fill: 'currentColor' }))
    }

    function Switch({ checked, disabled, label, onChange }) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': checked,
        'aria-label': label,
        disabled,
        className: `${P}-switch`,
        onClick: () => onChange(!checked),
      }, h('span', { className: `${P}-switchThumb` }))
    }

    function FieldRow({ label, hint, children, wide = false }) {
      return h('div', { className: `${P}-field${wide ? ` ${P}-fieldWide` : ''}` },
        h('div', { className: `${P}-fieldText` },
          h('span', { className: `${P}-fieldLabel` }, label),
          hint ? h('span', { className: `${P}-fieldHint` }, hint) : null),
        h('div', { className: `${P}-fieldControl` }, children))
    }

    /** One live character-video surface for the settings preview. */
    function PreviewCanvas({ video, settings, t }) {
      const canvasRef = useRef(null)
      const [failed, setFailed] = useState(false)
      const token = useAccessToken()

      useEffect(() => {
        setFailed(false)
        const canvas = canvasRef.current
        if (video === undefined || canvas === null || (video.builtin !== true && token === '')) return undefined
        const element = document.createElement('video')
        element.muted = true
        element.loop = true
        element.playsInline = true
        element.preload = 'auto'
        element.setAttribute('aria-hidden', 'true')
        element.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none;'
        element.src = videoUrl(video)
        document.body.appendChild(element)

        const renderer = (() => {
          try {
            return new AsciiRenderer(canvas, element, {
              ...settings,
              cellSize: Math.max(MIN_CELL_SIZE, settings.cellSize - 3),
            })
          } catch {
            setFailed(true)
            element.remove()
            return null
          }
        })()
        if (renderer === null) return undefined
        const onLoaded = () => {
          renderer.resize()
          element.play().catch(() => {})
        }
        const onError = () => setFailed(true)
        element.addEventListener('loadeddata', onLoaded)
        element.addEventListener('error', onError)
        if (element.readyState >= 2) onLoaded()
        renderer.start()

        return () => {
          renderer.dispose()
          element.removeEventListener('loadeddata', onLoaded)
          element.removeEventListener('error', onError)
          element.pause()
          element.removeAttribute('src')
          element.load()
          element.remove()
        }
        // The renderer is recreated when a structural presentation choice
        // changes; opacity stays a CSS concern.
      }, [token, video?.id, settings.cellSize, settings.theme, settings.fit, settings.fps])

      return h('div', { className: `${P}-previewFrame`, style: { opacity: settings.opacity } },
        h('canvas', { ref: canvasRef, className: `${P}-previewCanvas` }),
        failed ? h('div', { className: `${P}-previewError` }, t('videoLoadError')) : null)
    }

    function VideoRow({ video, active, busy, t, onUse, onRemove }) {
      return h('li', { className: `${P}-video`, 'data-active': active ? 'true' : undefined },
        h('div', { className: `${P}-videoGlyph`, 'aria-hidden': 'true' }, h('span', null, '#'), h('span', null, '_')),
        h('div', { className: `${P}-videoMeta` },
          h('span', { className: `${P}-videoName`, title: video.name }, video.name),
          h('span', { className: `${P}-videoSub` }, `${formatBytes(video.bytes)} · ${video.type.replace(/^video\//, '') || 'video'}`)),
        active
          ? h('span', { className: `${P}-activeBadge` }, h(CheckIcon, { size: 11 }), t('activeBadge'))
          : h('button', {
            type: 'button',
            className: `${P}-button ${P}-buttonSmall`,
            disabled: busy,
            onClick: () => onUse(video.id),
          }, t('useVideo')),
        h('button', {
          type: 'button',
          className: `${P}-iconButton ${P}-danger`,
          disabled: busy,
          title: t('removeHint'),
          'aria-label': t('removeLabel', { name: video.name }),
          onClick: () => onRemove(video.id),
        }, h(TrashIcon, { size: 14 })))
    }

    /**
     * Settings > 字符视频背景. The page owns no host config: uploads go to the
     * two plugin routes and the chosen attachment references stay here.
     */
    function SettingsPage({ t }) {
      const state = useSettingsState()
      const [busy, setBusy] = useState(null)
      const [progress, setProgress] = useState(0)
      const [error, setError] = useState('')
      const [dragOver, setDragOver] = useState(false)
      const [storageError, setStorageError] = useState(false)
      const inputRef = useRef(null)
      const active = state.videos.find((video) => video.id === state.activeId)

      const update = useCallback((mutator) => {
        const saved = commitState(mutator)
        setStorageError(!saved)
      }, [])

      const addVideo = useCallback(async (file) => {
        setError('')
        setStorageError(false)
        if (file.size > MAX_BYTES) {
          setError(t('tooLarge'))
          return
        }
        if (!file.type.startsWith('video/') && !/\.(mp4|m4v|webm|ogv|ogg|mov|mkv)$/i.test(file.name)) {
          setError(t('unsupported'))
          return
        }
        setBusy(file.name)
        setProgress(0)
        try {
          await refreshToken()
          const result = await uploadVideo(file, (value) => setProgress(value))
          const video = {
            id: uid(),
            name: file.name,
            type: typeof result.type === 'string' ? result.type : (file.type || 'application/octet-stream'),
            bytes: result.ref.bytes,
            addedAt: Date.now(),
            ref: result.ref,
          }
          update((current) => ({
            ...current,
            enabled: true,
            activeId: video.id,
            videos: [video, ...current.videos].slice(0, MAX_VIDEOS),
          }))
          await saveStateNow()
          setProgress(1)
        } catch (uploadError) {
          if (uploadError.status === 413) setError(t('tooLarge'))
          else if (uploadError.status === 403 || uploadError.status === 404 || uploadError.status === 501 || String(uploadError.message).includes('token')) setError(t('hostUnavailable'))
          else setError(t('uploadFailed'))
        } finally {
          setBusy(null)
          setProgress(0)
        }
      }, [t, update])

      const acceptFiles = useCallback((files) => {
        const file = Array.from(files ?? []).find((candidate) => candidate instanceof File)
        if (file === undefined) {
          setError(t('unsupported'))
          return
        }
        addVideo(file)
      }, [addVideo, t])

      const removeVideo = useCallback((id) => {
        update((current) => {
          const videos = current.videos.filter((video) => video.id !== id)
          return { ...current, videos, activeId: current.activeId === id ? (videos[0]?.id ?? null) : current.activeId }
        })
      }, [update])

      const headline = h('header', { className: `${P}-head` },
        h('h2', { className: `${P}-title` }, t('title')),
        h('p', { className: `${P}-intro` }, t('intro')))

      const addButton = h('button', {
        type: 'button',
        className: `${P}-button ${P}-primary`,
        disabled: busy !== null,
        onClick: () => inputRef.current?.click(),
      }, h(PlusIcon, { size: 13 }), busy === null ? t('addVideo') : t('uploading', { percent: Math.round(progress * 100) }))

      const input = h('input', {
        ref: inputRef,
        type: 'file',
        accept: 'video/*,.mp4,.m4v,.webm,.ogv,.ogg,.mov,.mkv',
        style: { display: 'none' },
        onChange: (event) => {
          acceptFiles(event.target.files)
          event.target.value = ''
        },
      })

      return h('div', {
        className: `${P}-page`,
        onDragOver: (event) => {
          event.preventDefault()
          setDragOver(true)
        },
        onDragLeave: (event) => {
          if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) {
            setDragOver(false)
          }
        },
        onDrop: (event) => {
          event.preventDefault()
          setDragOver(false)
          acceptFiles(event.dataTransfer?.files)
        },
      },
      headline,
      h('section', { className: `${P}-card${dragOver ? ` ${P}-cardDrag` : ''}` },
        h('div', { className: `${P}-sectionHead` },
          h('div', null,
            h('h3', { className: `${P}-sectionTitle` }, t('videosTitle')),
            h('p', { className: `${P}-sectionHint` }, t('videosHint'))),
          addButton),
        input,
        busy !== null
          ? h('div', { className: `${P}-upload`, role: 'status' },
            h('span', { className: `${P}-uploadText` }, t('uploading', { percent: Math.round(progress * 100) })),
            h('span', { className: `${P}-progress` }, h('span', { className: `${P}-progressBar`, style: { width: `${Math.max(2, Math.round(progress * 100))}%` } })))
          : null,
        state.videos.length === 0
          ? h('div', { className: `${P}-empty` },
            h('span', { className: `${P}-emptyIcon` }, h(FilmIcon, { size: 30 })),
            h('strong', { className: `${P}-emptyTitle` }, t('emptyTitle')),
            h('p', { className: `${P}-emptyHint` }, t('emptyHint')),
            h('button', { type: 'button', className: `${P}-button`, onClick: () => inputRef.current?.click() }, h(PlusIcon, { size: 13 }), t('chooseFile')),
            h('span', { className: `${P}-dropHint` }, t('dropHint')))
          : h('ul', { className: `${P}-videoList` }, state.videos.map((video) => h(VideoRow, {
            key: video.id,
            video,
            active: video.id === state.activeId,
            busy: busy !== null,
            t,
            onUse: (id) => update((current) => ({ ...current, activeId: id, enabled: true })),
            onRemove: removeVideo,
          }))),
        error !== '' ? h('p', { className: `${P}-error`, role: 'alert' }, error) : null,
        storageError ? h('p', { className: `${P}-error`, role: 'alert' }, t('storageFailed')) : null,
        h('p', { className: `${P}-footnote` }, t('storageHint'))),

      h('section', { className: `${P}-card` },
        h('div', { className: `${P}-sectionHead` },
          h('div', null,
            h('h3', { className: `${P}-sectionTitle` }, t('enabled')),
            h('p', { className: `${P}-sectionHint` }, t('enabledHint'))),
          h(Switch, {
            checked: state.enabled,
            label: t('enabled'),
            onChange: (checked) => update((current) => ({ ...current, enabled: checked })),
          })),
        h('div', { className: `${P}-fields` },
          h(FieldRow, { label: t('cellSize'), hint: t('cellSizeHint') },
            h('div', { className: `${P}-slider` },
              h('input', {
                type: 'range',
                min: MIN_CELL_SIZE,
                max: MAX_CELL_SIZE,
                step: 1,
                value: state.cellSize,
                'aria-label': t('cellSize'),
                onChange: (event) => update((current) => ({ ...current, cellSize: Number(event.target.value) })),
              }),
              h('span', { className: `${P}-value` }, `${state.cellSize}px`))),
          h(FieldRow, { label: t('opacity'), hint: t('opacityHint') },
            h('div', { className: `${P}-slider` },
              h('input', {
                type: 'range',
                min: 20,
                max: 100,
                step: 1,
                value: Math.round(state.opacity * 100),
                'aria-label': t('opacity'),
                onChange: (event) => update((current) => ({ ...current, opacity: Number(event.target.value) / 100 })),
              }),
              h('span', { className: `${P}-value` }, `${Math.round(state.opacity * 100)}%`))),
          h(FieldRow, { label: t('theme'), hint: t('themeHint') },
            h('select', {
              className: `${P}-select`,
              value: state.theme,
              'aria-label': t('theme'),
              onChange: (event) => update((current) => ({ ...current, theme: event.target.value })),
            },
            h('option', { value: 'original' }, t('themeOriginal')),
            h('option', { value: 'miku' }, t('themeMiku')),
            h('option', { value: 'amber' }, t('themeAmber')),
            h('option', { value: 'mono' }, t('themeMono')))),
          h(FieldRow, { label: t('fit'), hint: t('fitHint') },
            h('select', {
              className: `${P}-select`,
              value: state.fit,
              'aria-label': t('fit'),
              onChange: (event) => update((current) => ({ ...current, fit: event.target.value })),
            },
            h('option', { value: 'cover' }, t('fitCover')),
            h('option', { value: 'contain' }, t('fitContain')))),
          h(FieldRow, { label: t('fps'), hint: t('fpsHint') },
            h('select', {
              className: `${P}-select`,
              value: String(state.fps),
              'aria-label': t('fps'),
              onChange: (event) => update((current) => ({ ...current, fps: Number(event.target.value) })),
            },
            FPS_VALUES.map((value) => h('option', { key: value, value: String(value) }, `${value} fps`)))))),

      h('section', { className: `${P}-card` },
        h('div', { className: `${P}-sectionHead` },
          h('div', null,
            h('h3', { className: `${P}-sectionTitle` }, t('preview')),
            h('p', { className: `${P}-sectionHint` }, t('previewHint'))),
          state.videos.length > 0 ? h('span', { className: `${P}-previewCount` }, `${state.videos.length}`) : null),
        active !== undefined
          ? h(PreviewCanvas, { video: active, settings: state, t })
          : h('div', { className: `${P}-previewEmpty` }, h(FilmIcon, { size: 24 }), h('span', null, t('previewEmpty')))),

      h('p', { className: `${P}-credit` }, t('credit')))
    }

    /**
     * The fixed backdrop itself. It portals a canvas behind #root and only
     * turns the shell translucent after the chosen video can actually decode.
     */
    function AsciiBackground() {
      const state = useSettingsState()
      const active = state.videos.find((video) => video.id === state.activeId)
      const canvasRef = useRef(null)
      const rendererRef = useRef(null)
      const token = useAccessToken()

      useEffect(() => {
        if (!state.enabled || active === undefined || (active.builtin !== true && token === '')) {
          document.documentElement.removeAttribute('data-avb-active')
          return undefined
        }
        const canvas = canvasRef.current
        if (canvas === null) return undefined

        const element = document.createElement('video')
        element.muted = true
        element.loop = true
        element.playsInline = true
        element.preload = 'auto'
        element.setAttribute('aria-hidden', 'true')
        element.style.cssText = 'position:fixed;left:-10px;top:-10px;width:1px;height:1px;opacity:0;pointer-events:none;'
        element.src = videoUrl(active)
        document.body.appendChild(element)

        const renderer = (() => {
          try {
            return new AsciiRenderer(canvas, element, state)
          } catch {
            element.remove()
            return null
          }
        })()
        if (renderer === null) return undefined
        rendererRef.current = renderer
        let activated = false
        const activate = () => {
          activated = true
          document.documentElement.setAttribute('data-avb-active', '')
          renderer.resize()
          element.play().catch(() => {})
        }
        const deactivate = () => {
          if (activated) document.documentElement.removeAttribute('data-avb-active')
          activated = false
        }
        element.addEventListener('loadeddata', activate)
        element.addEventListener('error', deactivate)
        if (element.readyState >= 2) activate()
        renderer.start()

        return () => {
          rendererRef.current = null
          renderer.dispose()
          element.removeEventListener('loadeddata', activate)
          element.removeEventListener('error', deactivate)
          element.pause()
          element.removeAttribute('src')
          element.load()
          element.remove()
          deactivate()
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, [state.enabled, active?.id, token])

      useEffect(() => {
        rendererRef.current?.setOptions({
          cellSize: state.cellSize,
          theme: state.theme,
          fit: state.fit,
          fps: state.fps,
        })
      }, [state.cellSize, state.theme, state.fit, state.fps])

      if (!state.enabled || active === undefined) return null
      return ReactDOM.createPortal(
        h('div', {
          className: `${P}-backdrop`,
          'aria-hidden': 'true',
          style: { opacity: state.opacity },
        },
        h('canvas', { ref: canvasRef, className: `${P}-canvas` }),
        h('div', { className: `${P}-vignette` })),
        document.body,
      )
    }

    const STYLES = `
html[data-avb-active],html[data-avb-active] body{background:transparent!important}
html[data-avb-active] #root{position:relative;z-index:1;background:transparent!important}
html[data-avb-active] #root>div{background:transparent!important}
html[data-avb-active] #root>div>div[class*="_frame"]{background:color-mix(in srgb,var(--dsw-alias-bg-base) 70%,transparent)!important}
html[data-avb-active] body[data-ds-dark-theme] #root>div>div[class*="_frame"]{background:color-mix(in srgb,var(--dsw-alias-bg-base) 62%,transparent)!important}
html[data-avb-active] #root>div>div[class*="_frame"] [class*="_centerCol"],html[data-avb-active] #root>div>div[class*="_frame"] [class*="_rightbarCol"],html[data-avb-active] #root>div>div[class*="_frame"] [class*="_bottomRow"],html[data-avb-active] #root>div>div[class*="_frame"] [class*="_sidebarCol"],html[data-avb-active] #root>div>div[class*="_frame"] [class*="_mainPanel"],html[data-avb-active] #root>div>div[class*="_frame"] [class*="_mainPanel"]>div,html[data-avb-active] #root>div>div[class*="_frame"] [class*="_mainPanel"]>div>div,html[data-avb-active] #root>div>div[class*="_frame"] [class*="_mainPanel"]>div>div>*,html[data-avb-active] #root>div>div[class*="_frame"] [class*="_sidebarCol"]>*,html[data-avb-active] #root>div>div[class*="_frame"] [class*="_sidebarCol"]>div>*,html[data-avb-active] #root>div>div[class*="_frame"] [class*="_rightbarCol"]>*,html[data-avb-active] #root>div>div[class*="_frame"] [class*="_rightbarCol"]>div>*{background:transparent!important}
html[data-avb-active][data-windows-titlebar] [class*="_frame"]:before{background:color-mix(in srgb,var(--dsw-specific-sidebar-fill) 35%,transparent)!important}
html[data-avb-active] [class*="_composerSeat"]{background-image:none!important}
.${P}-backdrop{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none;background:radial-gradient(1200px 800px at 50% 30%,#0b1418 0%,#05090c 58%,#020304 100%)}
.${P}-canvas{position:absolute;inset:0;display:block;width:100%;height:100%}
.${P}-vignette{position:absolute;inset:0;background:radial-gradient(ellipse at center,transparent 32%,rgba(0,0,0,.56) 100%);pointer-events:none}
.${P}-page{display:flex;flex-direction:column;gap:20px;max-width:760px;color:var(--dsw-alias-label-primary)}
.${P}-head{display:flex;flex-direction:column;gap:6px}
.${P}-title{margin:0;font-size:18px;line-height:26px;font-weight:600}
.${P}-intro{margin:0;font-size:13px;line-height:20px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.${P}-card{display:flex;flex-direction:column;gap:14px;box-sizing:border-box;padding:16px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-lg,10px);background:var(--dsw-alias-bg-layer-1)}
.${P}-cardDrag{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px var(--dsw-alias-brand-primary)}
.${P}-sectionHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
.${P}-sectionTitle{margin:0;font-size:14px;line-height:22px;font-weight:600}
.${P}-sectionHint{margin:3px 0 0;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));max-width:52em}
.${P}-button{box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;gap:5px;height:32px;padding:0 12px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,8px);background:transparent;color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}
.${P}-button:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.${P}-button:disabled{opacity:.45;cursor:not-allowed}
.${P}-buttonSmall{height:28px;padding:0 10px;font-size:12px}
.${P}-primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:var(--dsw-alias-label-primary-foreground,#fff)}
.${P}-primary:hover:not(:disabled){background:var(--dsw-alias-brand-primary);filter:brightness(1.06)}
.${P}-iconButton{flex:none;display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;padding:0;border:none;border-radius:var(--dsw-radius-sm,6px);background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.${P}-iconButton:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}
.${P}-danger:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover-danger);color:var(--dsw-alias-state-error-primary)}
.${P}-videoList{display:flex;flex-direction:column;gap:8px;margin:0;padding:0;list-style:none}
.${P}-video{display:flex;align-items:center;gap:10px;min-width:0;padding:9px 10px;border:.5px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-md,8px);background:var(--dsw-alias-bg-layer-2)}
.${P}-video[data-active=true]{border-color:var(--dsw-alias-brand-primary);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dsw-alias-brand-primary) 28%,transparent)}
.${P}-videoGlyph{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;width:48px;height:34px;border-radius:6px;background:#05090c;color:#7eff60;font:600 11px/12px var(--ds-font-family-code,"Cascadia Mono",Consolas,monospace);letter-spacing:1px}
.${P}-videoMeta{display:flex;flex-direction:column;gap:2px;min-width:0;flex:1}
.${P}-videoName{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;line-height:20px}
.${P}-videoSub{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.${P}-activeBadge{flex:none;display:inline-flex;align-items:center;gap:3px;height:24px;padding:0 8px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary);font-size:12px;line-height:16px}
.${P}-empty{display:flex;flex-direction:column;align-items:center;gap:7px;padding:24px 16px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);text-align:center;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 60%,transparent)}
.${P}-emptyIcon{display:flex;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));margin-bottom:2px}
.${P}-emptyTitle{font-size:13px;line-height:20px;font-weight:500}
.${P}-emptyHint{margin:0 0 4px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));max-width:42em}
.${P}-dropHint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.${P}-upload{display:flex;flex-direction:column;gap:5px}
.${P}-uploadText{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}
.${P}-progress{display:block;height:4px;overflow:hidden;border-radius:2px;background:var(--dsw-alias-border-l2)}
.${P}-progressBar{display:block;height:100%;border-radius:2px;background:var(--dsw-alias-brand-primary);transition:width .15s ease-out}
.${P}-error{margin:0;font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary)}
.${P}-footnote{margin:0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.${P}-fields{display:flex;flex-direction:column;gap:2px;border-top:.5px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}
.${P}-field{display:flex;align-items:center;justify-content:space-between;gap:24px;min-width:0;padding:11px 0;border-bottom:.5px solid var(--dsw-alias-border-l1,var(--dsw-alias-border-l2))}
.${P}-field:last-child{border-bottom:none;padding-bottom:0}
.${P}-fieldText{display:flex;flex-direction:column;gap:1px;min-width:0}
.${P}-fieldLabel{font-size:13px;line-height:20px}
.${P}-fieldHint{font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
.${P}-fieldControl{flex:none;display:flex;align-items:center;justify-content:flex-end;gap:8px;min-width:132px}
.${P}-slider{display:flex;align-items:center;gap:8px}
.${P}-slider input[type=range]{width:116px;height:4px;margin:0;appearance:none;border-radius:2px;background:var(--dsw-alias-border-l2);accent-color:var(--dsw-alias-brand-primary);cursor:pointer}
.${P}-slider input[type=range]::-webkit-slider-thumb{appearance:none;width:13px;height:13px;border:none;border-radius:50%;background:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px var(--dsw-alias-bg-layer-1)}
.${P}-slider input[type=range]:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:3px}
.${P}-value{min-width:34px;text-align:right;font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.${P}-select{box-sizing:border-box;height:30px;min-width:104px;padding:0 26px 0 9px;border:.5px solid var(--dsw-alias-border-l3,var(--dsw-alias-border-l2));border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;line-height:18px;cursor:pointer}
.${P}-select:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.${P}-switch{position:relative;flex:none;width:36px;height:20px;padding:2px;border:none;border-radius:10px;background:var(--dsw-alias-border-l2);cursor:pointer;transition:background .15s ease-out}
.${P}-switch[aria-checked=true]{background:var(--dsw-alias-brand-primary)}
.${P}-switchThumb{display:block;width:16px;height:16px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);box-shadow:0 1px 2px rgba(0,0,0,.18);transition:transform .15s ease-out}
.${P}-switch[aria-checked=true] .${P}-switchThumb{transform:translateX(16px);background:var(--dsw-alias-bg-base)}
.${P}-switch:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.${P}-previewFrame{position:relative;display:flex;height:210px;overflow:hidden;border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);background:radial-gradient(800px 420px at 50% 34%,#0b1418,#030608)}
.${P}-previewCanvas{display:block;width:100%;height:100%}
.${P}-previewError{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(3,6,8,.82);color:#e8eeeb;font-size:12px;line-height:18px;text-align:center}
.${P}-previewEmpty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;height:160px;border:1px dashed var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-md,8px);color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary));font-size:12px;line-height:18px;background:color-mix(in srgb,var(--dsw-alias-bg-layer-2) 55%,transparent)}
.${P}-previewCount{flex:none;display:inline-flex;align-items:center;justify-content:center;min-width:22px;height:22px;padding:0 7px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}
.${P}-credit{margin:-4px 0 0;font-size:11px;line-height:17px;color:var(--dsw-alias-label-tertiary,var(--dsw-alias-label-secondary))}
@media (max-width:620px){.${P}-field{align-items:flex-start;flex-direction:column;gap:8px}.${P}-fieldControl{width:100%;justify-content:flex-start;min-width:0}.${P}-sectionHead{flex-direction:column;gap:10px}.${P}-video{flex-wrap:wrap}.${P}-videoMeta{flex-basis:calc(100% - 60px)}}
@media (prefers-reduced-motion:reduce){.${P}-progressBar,.${P}-switch,.${P}-switchThumb{transition:none}}
`

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, DICTIONARIES), `${NS}: dictionaries`)
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = NS
        tag.dataset.pluginCss = `${NS}/client.css`
        tag.textContent = STYLES
        document.head.appendChild(tag)
        return () => {
          tag.remove()
        }
      }, `${NS}: styles`)

      // Never block plugin registration on the metadata read: a custom-scheme
      // or old-Host fetch must not leave the whole app at "Loading plugins…".
      bootstrapState()

      const t = ctx.locale.bind(NS)
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: SETTINGS_ID,
        order: -100,
      }, AsciiBackground))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: SETTINGS_ID,
        order: 25,
        label: () => t('nav'),
        locale: NS,
      }, SettingsPage))

      ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
        name: 'settings.section.icon',
        id: SETTINGS_ID,
        order: 25,
      }, SettingsIcon))
    }

    return { name: NS, inject: ['slots', 'locale'], apply }
  },
})
