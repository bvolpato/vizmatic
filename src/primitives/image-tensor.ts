import React from 'react'
import { getThemeColors, type ThemeColors } from '../theme'

export type RgbPixel = readonly [number, number, number]

export interface PixelRegion {
    row: number
    column: number
    rows: number
    columns: number
}

export type RgbChannel = 'rgb' | 'red' | 'green' | 'blue'
export type TensorLayout = 'HWC' | 'CHW'

export interface PixelGridProps {
    pixels: readonly (readonly RgbPixel[])[]
    c?: ThemeColors
    width?: number
    height?: number
    channel?: RgbChannel
    region?: PixelRegion
    activeCell?: { row: number; column: number }
    highlightColor?: string
}

interface ImageShape {
    rows: number
    columns: number
}

const MAX_IMAGE_AXIS = 128
const MAX_IMAGE_PIXELS = 1024
const MAX_COMPONENT_SIZE = 32768

function validateRgbImage(pixels: readonly (readonly RgbPixel[])[]): ImageShape {
    if (!Array.isArray(pixels) || pixels.length === 0) {
        throw new Error('RGB image must contain at least one nonempty row')
    }
    if (pixels.length > MAX_IMAGE_AXIS) {
        throw new Error(`RGB image dimensions must be at most ${MAX_IMAGE_AXIS} rows and ${MAX_IMAGE_AXIS} columns`)
    }
    const firstRow = pixels[0]
    if (!Array.isArray(firstRow) || firstRow.length === 0) {
        throw new Error('RGB image must contain at least one nonempty row')
    }
    const columns = firstRow.length
    if (columns > MAX_IMAGE_AXIS) {
        throw new Error(`RGB image dimensions must be at most ${MAX_IMAGE_AXIS} rows and ${MAX_IMAGE_AXIS} columns`)
    }
    if (pixels.length * columns > MAX_IMAGE_PIXELS) {
        throw new Error(`RGB image must contain at most ${MAX_IMAGE_PIXELS} pixels`)
    }

    for (const [rowIndex, row] of pixels.entries()) {
        if (!Array.isArray(row) || row.length !== columns) {
            throw new Error('RGB image rows must be rectangular and nonempty')
        }
        for (const [columnIndex, pixel] of row.entries()) {
            if (!Array.isArray(pixel) || pixel.length !== 3) {
                throw new Error(`RGB pixel at row ${rowIndex}, column ${columnIndex} must contain exactly three channels`)
            }
            for (const [channelIndex, value] of pixel.entries()) {
                if (!Number.isInteger(value) || value < 0 || value > 255) {
                    throw new Error(`RGB channel ${channelIndex} at row ${rowIndex}, column ${columnIndex} must be an integer from 0 to 255`)
                }
            }
        }
    }

    return { rows: pixels.length, columns }
}

function validateChannel(channel: RgbChannel): void {
    if (channel !== 'rgb' && channel !== 'red' && channel !== 'green' && channel !== 'blue') {
        throw new Error("RGB channel must be 'rgb', 'red', 'green', or 'blue'")
    }
}

function validateRegion(region: PixelRegion, shape: ImageShape): void {
    if (!region || typeof region !== 'object') throw new Error('Pixel region must be an object with integer bounds')
    const { row, column, rows, columns } = region
    if (![row, column, rows, columns].every(Number.isInteger) || row < 0 || column < 0 || rows < 1 || columns < 1) {
        throw new Error('Pixel region row and column must be nonnegative integers, with positive integer rows and columns')
    }
    if (row + rows > shape.rows || column + columns > shape.columns) {
        throw new Error('Pixel region must lie within the RGB image bounds')
    }
}

function validateCell(cell: { row: number; column: number }, shape: ImageShape): void {
    if (!cell || typeof cell !== 'object') throw new Error('Active pixel cell must be an object with integer coordinates')
    if (!Number.isInteger(cell.row) || !Number.isInteger(cell.column) || cell.row < 0 || cell.column < 0
        || cell.row >= shape.rows || cell.column >= shape.columns) {
        throw new Error('Active pixel cell must lie within the RGB image bounds')
    }
}

/** Return one exact byte-valued color plane from an RGB image. */
export function rgbChannel(pixels: readonly (readonly RgbPixel[])[], channel: 'red' | 'green' | 'blue'): number[][] {
    const { columns } = validateRgbImage(pixels)
    if (channel !== 'red' && channel !== 'green' && channel !== 'blue') {
        throw new Error("RGB matrix channel must be 'red', 'green', or 'blue'")
    }
    const channelIndex = channel === 'red' ? 0 : channel === 'green' ? 1 : 2
    return pixels.map(row => Array.from({ length: columns }, (_, column) => row[column][channelIndex]))
}

/** Return a copied, row-major rectangular crop of an RGB image. */
export function cropRgbImage(pixels: readonly (readonly RgbPixel[])[], region: PixelRegion): RgbPixel[][] {
    const shape = validateRgbImage(pixels)
    validateRegion(region, shape)
    return pixels.slice(region.row, region.row + region.rows).map(row =>
        row.slice(region.column, region.column + region.columns).map(pixel => [pixel[0], pixel[1], pixel[2]] as const))
}

/** Flatten RGB bytes in HWC (interleaved) or CHW (planar) order. */
export function flattenRgbImage(
    pixels: readonly (readonly RgbPixel[])[],
    layout: TensorLayout = 'HWC',
    normalize = false,
): number[] {
    validateRgbImage(pixels)
    if (layout !== 'HWC' && layout !== 'CHW') throw new Error("RGB tensor layout must be 'HWC' or 'CHW'")
    if (typeof normalize !== 'boolean') throw new Error('RGB tensor normalization must be a boolean')

    const values = layout === 'HWC'
        ? pixels.flatMap(row => row.flatMap(pixel => [pixel[0], pixel[1], pixel[2]]))
        : Array.from({ length: 3 }, (_, channel) =>
            pixels.flatMap(row => row.map(pixel => pixel[channel]))).flat()
    return normalize ? values.map(value => value / 255) : values
}

/** Render each source pixel as an exact square SVG cell, with optional overlays. */
export function PixelGrid({
    pixels,
    c = getThemeColors('dark'),
    width = 320,
    height = 320,
    channel = 'rgb',
    region,
    activeCell,
    highlightColor,
}: PixelGridProps): React.ReactElement {
    const shape = validateRgbImage(pixels)
    validateChannel(channel)
    if (![width, height].every(value => Number.isFinite(value) && value > 0 && value <= MAX_COMPONENT_SIZE)) {
        throw new Error(`PixelGrid width and height must be finite values greater than 0 and at most ${MAX_COMPONENT_SIZE}`)
    }
    if (region !== undefined) validateRegion(region, shape)
    if (activeCell !== undefined) validateCell(activeCell, shape)
    if (highlightColor !== undefined && (typeof highlightColor !== 'string' || highlightColor.trim().length === 0)) {
        throw new Error('PixelGrid highlightColor must be a nonempty color string')
    }

    const pixelSize = Math.min(width / shape.columns, height / shape.rows)
    const imageWidth = pixelSize * shape.columns
    const imageHeight = pixelSize * shape.rows
    const offsetX = (width - imageWidth) / 2
    const offsetY = (height - imageHeight) / 2
    const colorFor = (pixel: RgbPixel): string => {
        const rgb = channel === 'red' ? [pixel[0], 0, 0]
            : channel === 'green' ? [0, pixel[1], 0]
                : channel === 'blue' ? [0, 0, pixel[2]]
                    : pixel
        return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`
    }
    const cells = pixels.flatMap((row, rowIndex) => row.map((pixel, columnIndex) =>
        React.createElement('rect', {
            key: `pixel-${rowIndex}-${columnIndex}`,
            x: offsetX + columnIndex * pixelSize,
            y: offsetY + rowIndex * pixelSize,
            width: pixelSize,
            height: pixelSize,
            fill: colorFor(pixel),
        })))
    const strokeWidth = pixelSize * 0.16
    const marks: React.ReactNode[] = [...cells]
    if (region) {
        marks.push(React.createElement('rect', {
            key: 'region-highlight',
            x: offsetX + region.column * pixelSize + strokeWidth / 2,
            y: offsetY + region.row * pixelSize + strokeWidth / 2,
            width: region.columns * pixelSize - strokeWidth,
            height: region.rows * pixelSize - strokeWidth,
            fill: 'none',
            stroke: highlightColor ?? c.primary,
            strokeWidth,
            strokeDasharray: `${pixelSize * 0.32} ${pixelSize * 0.2}`,
        }))
    }
    if (activeCell) {
        marks.push(React.createElement('rect', {
            key: 'active-cell-highlight',
            x: offsetX + activeCell.column * pixelSize + strokeWidth / 2,
            y: offsetY + activeCell.row * pixelSize + strokeWidth / 2,
            width: pixelSize - strokeWidth,
            height: pixelSize - strokeWidth,
            fill: 'none',
            stroke: c.warning,
            strokeWidth,
        }))
    }

    const channelLabel = channel === 'rgb' ? 'RGB' : `${channel} channel`
    return React.createElement('div', {
        role: 'img',
        'aria-label': `${shape.rows} by ${shape.columns} pixel image, ${channelLabel}`,
        style: { position: 'relative', display: 'flex', width, height, backgroundColor: c.bgCard, flexShrink: 0 },
    }, React.createElement('svg', {
        width,
        height,
        viewBox: `0 0 ${width} ${height}`,
        preserveAspectRatio: 'xMidYMid meet',
        shapeRendering: 'crispEdges',
    }, ...marks))
}
