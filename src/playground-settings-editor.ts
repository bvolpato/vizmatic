import { readPlaygroundSettings, updatePlaygroundSettings, type PlaygroundSettingsPatch } from './playground-settings'
import { themeColorKeys, type ThemeColorKey } from './frame-theme'
import { getThemeColors, type ThemeMode } from './theme'

interface SettingsEditorApi {
    getSource(): string
    getTheme(): ThemeMode
    getBackground(): string
    saveSource(source: string, group?: string): void
    onError(message?: string): void
}

export function mountPlaygroundSettingsEditor(root: HTMLElement, api: SettingsEditorApi): { sourceChanged(): void } {
    const width = root.querySelector<HTMLInputElement>('#playgroundCanvasWidth')
    const height = root.querySelector<HTMLInputElement>('#playgroundCanvasHeight')
    const preset = root.querySelector<HTMLSelectElement>('#playgroundCanvasPreset')
    const background = root.querySelector<HTMLSelectElement>('#explorerBackground')
    const backgroundColor = root.querySelector<HTMLInputElement>('#playgroundCanvasBackgroundColor')
    const token = root.querySelector<HTMLSelectElement>('#playgroundPaletteToken')
    const value = root.querySelector<HTMLInputElement>('#playgroundPaletteValue')
    const color = root.querySelector<HTMLInputElement>('#playgroundPaletteColor')
    const reset = root.querySelector<HTMLButtonElement>('#playgroundPaletteReset')
    const resetToken = root.querySelector<HTMLButtonElement>('#playgroundPaletteResetToken')
    const note = root.querySelector<HTMLElement>('#playgroundPaletteNote')
    const controls = [width, height, preset, background, backgroundColor, token, value, color, reset, resetToken]
    if (token) {
        token.replaceChildren(...themeColorKeys.map((key) => {
            const option = document.createElement('option')
            option.value = key
            option.textContent = key
            return option
        }))
        token.value = 'primary'
    }

    function selectedToken(): ThemeColorKey {
        return themeColorKeys.find((key) => key === token?.value) ?? 'primary'
    }

    function sourceChanged(): void {
        try {
            const settings = readPlaygroundSettings(api.getSource())
            for (const control of controls) if (control) control.disabled = false
            if (width) width.value = String(settings.width)
            if (height) height.value = String(settings.height)
            if (preset) preset.value = settings.preset
            const fill = settings.background ?? api.getBackground()
            if (background) background.value = fill === 'theme' || fill === 'transparent' ? fill : 'custom'
            if (backgroundColor) {
                backgroundColor.hidden = background?.value !== 'custom'
                if (!backgroundColor.hidden) backgroundColor.value = fill
            }
            const key = selectedToken()
            const resolved = settings.themeColors?.[key] ?? getThemeColors(api.getTheme(), settings.preset)[key]
            if (value) value.value = resolved
            if (color) {
                color.value = /^#[\da-f]{6}$/i.test(resolved) ? resolved : '#000000'
                color.style.backgroundColor = resolved
            }
            if (reset) reset.disabled = !settings.themeColors
            if (resetToken) resetToken.disabled = settings.themeColors?.[key] === undefined
            if (note) note.textContent = `${Object.keys(settings.themeColors ?? {}).length} custom colors. CSS colors, including hex, rgb() and hsl(), are supported.`
        } catch {
            for (const control of controls) if (control) control.disabled = true
            if (note) note.textContent = 'Finish the canvas metadata in the TSX to edit these settings.'
        }
    }

    function apply(patch: PlaygroundSettingsPatch, group?: string): void {
        try {
            const source = updatePlaygroundSettings(api.getSource(), patch)
            api.onError()
            api.saveSource(source, group)
            sourceChanged()
        } catch (error) {
            api.onError(error instanceof Error ? error.message : String(error))
        }
    }

    width?.addEventListener('change', () => apply({ width: width.valueAsNumber }))
    height?.addEventListener('change', () => apply({ height: height.valueAsNumber }))
    preset?.addEventListener('change', () => apply({ preset: preset.value === 'engineering' ? 'engineering' : 'default' }))
    background?.addEventListener('change', () => {
        if (backgroundColor) backgroundColor.hidden = background.value !== 'custom'
        if (background.value === 'custom') {
            if (backgroundColor) { backgroundColor.value = '#151620'; backgroundColor.focus() }
            apply({ background: backgroundColor?.value ?? '#151620' })
        } else apply({ background: background.value })
    })
    backgroundColor?.addEventListener('change', () => apply({ background: backgroundColor.value }))
    token?.addEventListener('change', sourceChanged)
    function setColor(next: string, group?: string): void {
        try {
            const settings = readPlaygroundSettings(api.getSource())
            apply({ themeColors: { ...settings.themeColors, [selectedToken()]: next } }, group)
        } catch (error) { api.onError(error instanceof Error ? error.message : String(error)) }
    }
    value?.addEventListener('change', () => setColor(value.value))
    color?.addEventListener('input', () => setColor(color.value, `palette:${selectedToken()}`))
    reset?.addEventListener('click', () => apply({ themeColors: null }))
    resetToken?.addEventListener('click', () => {
        try {
            const colors = { ...readPlaygroundSettings(api.getSource()).themeColors }
            delete colors[selectedToken()]
            apply({ themeColors: colors })
        } catch (error) { api.onError(error instanceof Error ? error.message : String(error)) }
    })
    sourceChanged()
    return { sourceChanged }
}
