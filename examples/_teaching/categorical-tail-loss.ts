import { createTeachingCategoricalSampling, categoricalSampling } from 'vizmatic'
import type { TeachingPainter } from 'vizmatic'
import type { CanvasBounds } from 'vizmatic'

/** Supplied deterministic draws illustrate one possible sample, not a randomly executed experiment. */
export const tailLossFixture = {
    normalization: 'probabilities' as const,
    categories: [{ id: 'common', label: 'Common', mass: .95 }, { id: 'rare', label: 'Rare', mass: .05 }],
    draws: [.1, .3, .5, .7, .9, .2, .4, .8].map((uniform, index) => ({ id: `S${index + 1}`, uniform })),
}

/** The caller binds progress and reveal to its narration; a prediction starts at zero with reveal=false. */
export function drawCategoricalTailLoss<Shape extends CanvasBounds>(painter: TeachingPainter<Shape>, progress: number, reveal: boolean, theme: 'dark' | 'light' = 'dark') {
    if (!Number.isFinite(progress) || progress < 0 || progress > 1) throw new Error('Example progress must be in [0,1]')
    const cursor = progress * tailLossFixture.draws.length, visibleDraws = Math.floor(cursor)
    return createTeachingCategoricalSampling(painter)({
        ...tailLossFixture, categories: tailLossFixture.categories.map((category, index) => ({ ...category, color: (theme === 'dark' ? ['#79A6FF', '#FF8DC3'] : ['#2459AD', '#9D2467'])[index] })),
        color: theme === 'dark' ? '#DEE7F5' : '#172033', trackColor: theme === 'dark' ? '#18283B' : '#E5EAF0', x: 180, y: 260, width: 1560, height: 690,
        visibleDraws, drawProgress: cursor - visibleDraws,
        showEmpirical: reveal,
    })
}

export const replacementDistribution = categoricalSampling(tailLossFixture).categories.map(category => ({ id: category.id, label: category.label, mass: category.empiricalProbability! }))
export const omissionProbability = .95 ** 8
