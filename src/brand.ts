/**
 * Vizmatic — Brand
 *
 * Wraps illustration elements with a "🧠 Vizmatic" brand
 * in the bottom-right corner. Applied automatically by the renderer
 * so individual illustrations don't need to add it.
 *
 * The brand uses the brand brain icon (from icon.svg SVG paths)
 * rendered via Satori-compatible JSX, plus the "Vizmatic" text.
 */

import React from 'react'

// ─── Brain Icon (SVG paths from /public/icon.svg) ────────────────────────────

/**
 * Builds the brain circuit icon using nested divs with absolute positioning.
 * Since Satori has limited SVG support, we embed a minimal inline SVG
 * that Satori CAN handle (simple paths + circles).
 *
 * Note: Satori supports basic <svg> with <path> elements.
 */
function BrainIcon({ size = 14, color }: { size?: number; color: string }): React.ReactElement {
    // Satori supports basic inline SVG with path elements
    return React.createElement('svg', {
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: color,
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
    },
        React.createElement('path', {
            d: 'M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z',
        }),
        React.createElement('path', { d: 'M9 13a4.5 4.5 0 0 0 3-4' }),
        React.createElement('path', { d: 'M6.003 5.125A3 3 0 0 0 6.401 6.5' }),
        React.createElement('path', { d: 'M3.477 10.896a4 4 0 0 1 .585-.396' }),
        React.createElement('path', { d: 'M6 18a4 4 0 0 1-1.967-.516' }),
        React.createElement('path', { d: 'M12 13h4' }),
        React.createElement('path', { d: 'M12 18h6a2 2 0 0 1 2 2v1' }),
        React.createElement('path', { d: 'M12 8h8' }),
        React.createElement('path', { d: 'M16 8V5a2 2 0 0 1 2-2' }),
        React.createElement('circle', { cx: 16, cy: 13, r: 0.5, fill: color }),
        React.createElement('circle', { cx: 18, cy: 3, r: 0.5, fill: color }),
        React.createElement('circle', { cx: 20, cy: 21, r: 0.5, fill: color }),
        React.createElement('circle', { cx: 20, cy: 8, r: 0.5, fill: color }),
    )
}

// ─── Brand Component ─────────────────────────────────────────────────────

const WATERMARK_COLOR_DARK = '#a78bfa'   // Lighter purple — visible on dark backgrounds
const WATERMARK_COLOR_LIGHT = '#7c3aed'  // Brand purple — visible on light backgrounds

/**
 * Wrap an illustration element with a brand at the top right.
 *
 * Layout:
 * ┌─────────────────────────────────────┐
 * │                      🧠 Vizmatic │
 * │                                     │
 * │       [original illustration]       │
 * │                                     │
 * └─────────────────────────────────────┘
 */
export function wrapWithBrand(
    element: React.ReactNode,
    width: number,
    height: number,
    theme: 'dark' | 'light' = 'dark',
    label = 'Vizmatic',
): React.ReactElement {
    const isDark = theme === 'dark'
    const color = isDark ? WATERMARK_COLOR_DARK : WATERMARK_COLOR_LIGHT

    return React.createElement('div', {
        style: {
            width,
            height,
            display: 'flex',
            position: 'relative' as const,
        }
    },
        // Original illustration fills the full canvas
        element,

        // Brand overlay — top right
        React.createElement('div', {
            style: {
                position: 'absolute' as const,
                top: 8,
                right: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                opacity: isDark ? 0.55 : 0.40,
            }
        },
            BrainIcon({ size: 13, color }),
            React.createElement('div', {
                style: {
                    fontSize: 11,
                    fontWeight: 600,
                    color,
                    fontFamily: 'Inter',
                    letterSpacing: 0.3,
                }
            }, label),
        ),
    )
}
