// The film: its title, its measured voice, and one function for each scene of script.json.
import { narrated } from 'vizmatic/stage'
import timing from './timing.json'
import { answer } from './scenes/answer'
import { question } from './scenes/question'

export default narrated({
    title: 'A cache, in two scenes',
    description: 'Why a cache makes the second request for a page fast.',
    // The words of the title card. Without this line, the card shows the title of the film.
    intro: { title: 'A cache', subtitle: 'in two scenes' },
    timing,
    scenes: { question, answer },
})
