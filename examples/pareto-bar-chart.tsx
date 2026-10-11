import {
    ParetoBarChart,
    Scene,
    getThemeColors,
    type ThemeMode,
} from 'vizmatic'

export const width = 1040
export const height = 570

const tickets = [
    { label: 'Setup', value: 42, color: 'primary' },
    { label: 'Authentication', value: 28, color: 'secondary' },
    { label: 'Slow responses', value: 18, color: 'warning' },
    { label: 'Other', value: 12, color: 'neutral' },
]

export function create(theme: ThemeMode = 'dark') {
    const c = getThemeColors(theme)

    return (
        <Scene
            c={c}
            title="Focus on the few causes behind most tickets"
            subtitle="Bars sort categories by count; the line tracks cumulative share"
            background={c.bg}
            padding={22}
            gap={14}
            align="center"
        >
            <ParetoBarChart
                c={c}
                width={920}
                height={320}
                title="Support tickets by root cause"
                subtitle="The first two categories account for 70% of reports"
                data={tickets}
                footer="Sample: 100 tickets from the past seven days"
            />
        </Scene>
    )
}

export default create('dark')
