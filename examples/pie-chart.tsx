import {
    PieChart,
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
            title="See where the support load comes from"
            subtitle="A pie chart shows each category as a share of all reported tickets"
            background={c.bg}
            padding={22}
            gap={14}
            align="center"
        >
            <PieChart
                c={c}
                width={920}
                height={310}
                size={220}
                title="Support tickets by root cause"
                subtitle="42 of 100 reports are setup questions"
                format="integer"
                segments={tickets}
                footer="Sample: 100 tickets from the past seven days"
            />
        </Scene>
    )
}

export default create('dark')
