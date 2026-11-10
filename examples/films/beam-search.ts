/**
 * Lesson `beam-search`: expand candidates, keep the two best prefixes, and compare their cumulative log scores.
 * Each weight is a log probability. Scores add along a path, and a larger score is better.
 * Yellow marks the beam. Green marks its best complete continuation. Dashed branches have been pruned.
 */
import { assertEqual, fadeIn, fadeOut, film, fitted, place, sceneKit, tree } from 'vizmatic/stage'

export default film({ title: 'A beam keeps more than one path', fps: 60 }, (s) => {
    const { area, heading, label } = sceneKit()
    const [picture, result] = area.rows([4, 1])
    const lattice = place(fitted(picture, (width) => tree({ id: 'start', label: 'start', children: [
        { id: 'create', label: 'create', weight: -0.51, children: [
            { id: 'c-user', label: 'user', weight: -1.2 },
            { id: 'c-key', label: 'key', weight: -0.92 },
            { id: 'c-quota', label: 'quota', weight: -1.61 },
        ] },
        { id: 'revoke', label: 'revoke', weight: -1.2, children: [
            { id: 'r-key', label: 'key', weight: -0.11 },
            { id: 'r-user', label: 'user', weight: -2.3 },
        ] },
        { id: 'rename', label: 'rename', weight: -2.3, children: [
            { id: 'n-user', label: 'user', weight: -0.36 },
        ] },
    ] }, { width, direction: 'right', score: 'sum', shown: 0 })), picture)
    const rule = place(label('Add the log probabilities along each path. Keep the two largest totals.'), result)
    s.add(heading('The second-best prefix can finish first'), lattice, rule)

    s.chapter('Expand the first prefixes')
    s.wait(1)
    s.play(lattice.grow(['create', 'revoke', 'rename']))
    s.wait(0.8)
    s.play(lattice.keep(['create', 'revoke']))
    s.wait(1.2)

    s.chapter('Extend both paths')
    s.play(lattice.grow(['c-user', 'c-key', 'c-quota', 'r-key', 'r-user']))
    s.wait(1)
    s.play(lattice.keep(['r-key', 'c-key']))
    s.wait(1.2)

    s.chapter('Choose the best complete path')
    assertEqual(Math.round(lattice.score('r-key') * 100), -131)
    assertEqual(Math.round(lattice.score('c-key') * 100), -143)
    s.play(lattice.path('r-key', { color: 'green' }), fadeOut(rule))
    s.play(lattice.setState('r-key', 'done'))
    const best = lattice.score('r-key').toFixed(2)
    const other = lattice.score('c-key').toFixed(2)
    const comparison = place(label(`revoke key: ${best}  >  create key: ${other}`, { color: 'green' }), result).hide()
    s.add(comparison)
    s.play(fadeIn(comparison))
    s.wait(4)
})
