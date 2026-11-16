import {
    Box, colorBar, column, dynamic, fadeIn, fadeOut, film, linear, place, row, scalarField, sceneKit, tex, text,
} from 'vizmatic/stage'
import { GRID_HEIGHT, GRID_WIDTH, parameters, pattern, STEPS } from './_reaction-diffusion/model'

export default film({
    title: 'Two chemicals. Endless patterns.',
    description: 'A deterministic Gray–Scott simulation grows and divides from one seed. Reaction competes with diffusion on a periodic plane; colors show a fixed concentration scale.',
    look: 'midnight', font: 'text-serif', fps: 60, poster: 33, bloom: 0.06,
}, (s) => {
    const simulation = pattern(), time = s.value(0)
    const kit = sceneKit({ size: 40, area: { left: -870, right: 870, top: -315, bottom: 260 }, heading: { size: 68, y: -465 }, source: { size: 27, y: -405 } })
    s.add(kit.heading('Two chemicals. Endless patterns.'))
    s.add(kit.source('Gray–Scott model · Pearson, Science 261 (1993) · dimensionless, periodic boundaries'))
    const [imageBox, side] = kit.area.columns([2.2, 1], 70)
    const colors = ['bg', 'blue', 'teal', 'yellow'] as const
    const field = scalarField((x, y) => simulation.sample(x, y, time.value), {
        x: [0, GRID_WIDTH], y: [0, GRID_HEIGHT], domain: [0, 0.55], colors,
        width: imageBox.height * GRID_WIDTH / GRID_HEIGHT, height: imageBox.height, resolution: [256, 160],
    })
    s.add(place(field, imageBox))
    const [chapterBox, equationBox, explanationBox, numberBox] = side.rows([50, 250, 165, 56], 18)
    const equations = column([
        tex('\\partial_t u = D_u\\nabla^2u', { size: 42, color: 'blue' }),
        tex('\\quad-uv^2+F(1-u)', { size: 42, color: 'blue' }),
        tex('\\partial_t v = D_v\\nabla^2v', { size: 42, color: 'teal' }),
        tex('\\quad+uv^2-(F+k)v', { size: 42, color: 'teal' }),
    ], { gap: 12, align: 'left' })
    s.add(place(equations, equationBox, 'left'))
    const chapters = [
        ['A small beginning', 'A patch of v enters a sea of u. Every point follows the same two equations.'],
        ['Reaction feeds growth', 'The uv² term consumes u and creates v. A small imbalance grows.'],
        ['Diffusion shapes the edges', 'Both chemicals spread. u diffuses twice as fast as v. Spots divide and compete.'],
        ['Local rules. Global patterns.', 'No shape is drawn into the model. These patterns emerge from reaction and diffusion.'],
    ]
    const headings = chapters.map(([heading]) => place(kit.label(heading, { size: 36, color: 'yellow' }), chapterBox, 'left'))
    const explanations = chapters.map(([, body]) => place(kit.para(body, side.width, { size: 34, color: 'dim' }), explanationBox, 'left'))
    s.add(headings[0], explanations[0])
    s.add(dynamic(() => place(row([
        text('t', { size: 32, color: 'dim' }),
        text(Math.round(time.value).toLocaleString('en-US'), { size: 46, font: 'mono', color: 'yellow' }),
    ], { gap: 18 }), numberBox, 'left').nodes))
    const legend = new Box(imageBox.left, 285, imageBox.right, 350)
    const [labelBox, barBox] = legend.columns([1, 2], 36)
    s.add(place(text('v concentration', { size: 30, color: 'dim' }), labelBox, 'left'))
    s.add(place(colorBar({ domain: [0, 0.55], colors, width: barBox.width - 50, height: 22, ticks: [0, 0.15, 0.3, 0.45, 0.55], labelSize: 28 }), barBox))
    s.add(place(text(`F = ${parameters.feed}   k = ${parameters.kill}`, { size: 28, color: 'dim', font: 'mono' }), new Box(side.left, 285, side.right, 350), 'left'))

    const change = (index: number) => {
        s.play(fadeOut(headings[index - 1]), fadeOut(explanations[index - 1]), { duration: 0.25 })
        s.play(fadeIn(headings[index]), fadeIn(explanations[index]), { duration: 0.35 })
    }
    s.chapter('One seed')
    s.caption('Two chemicals follow the same local rules. The color scale is fixed throughout.', 6)
    s.wait(1)
    s.play(time.to(480, { ease: linear }), { duration: 5 })
    s.chapter('Reaction')
    change(1)
    s.caption('The autocatalytic reaction consumes u and makes more v. The seed develops a rim.', 10)
    s.play(time.to(1920, { ease: linear }), { duration: 9.4 })
    s.chapter('Diffusion')
    change(2)
    s.caption('Diffusion spreads u twice as fast as v. The growing pattern divides into spots.', 12)
    s.play(time.to(4800, { ease: linear }), { duration: 11.4 })
    s.chapter('Emergence')
    change(3)
    s.caption('A numerical solution of the Gray–Scott model, with periodic edges and no prescribed pattern.', 12)
    s.play(time.to(STEPS, { ease: linear }), { duration: 8.4 })
    s.wait(3)
})
