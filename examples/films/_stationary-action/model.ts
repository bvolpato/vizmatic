// Hamilton's principle with fixed positions AND times:
// https://www.damtp.cam.ac.uk/user/tong/dynamics/dynhtml/S2.html#S2.SS1
// SI units; uniform gravity, no drag. Trial paths are kinematic variations,
// not additional solutions of the equation of motion.
export const mass = 1
export const gravity = 9.81
export const flightTime = 2
export const distance = 12

export function path(t: number, epsilon = 0): [number, number] {
    return [distance * t / flightTime,
        gravity * t * (flightTime - t) / 2 + epsilon * Math.sin(Math.PI * t / flightTime)]
}

export function velocity(t: number, epsilon = 0): [number, number] {
    return [distance / flightTime,
        gravity * (flightTime / 2 - t) + epsilon * Math.PI / flightTime * Math.cos(Math.PI * t / flightTime)]
}

export function lagrangian(t: number, epsilon = 0): number {
    const [vx, vy] = velocity(t, epsilon)
    return mass * (vx * vx + vy * vy) / 2 - mass * gravity * path(t, epsilon)[1]
}

// Integrating the cross term by parts gives zero because eta(0)=eta(T)=0
// and y*''=-g. The surviving term is (m/2) integral eta-dot squared.
export function action(epsilon = 0): number {
    return mass * distance ** 2 / (2 * flightTime)
        - mass * gravity ** 2 * flightTime ** 3 / 24
        + mass * Math.PI ** 2 * epsilon ** 2 / (4 * flightTime)
}

export function actionIntegral(epsilon = 0, until = flightTime, steps = 200): number {
    const dt = until / steps
    let sum = lagrangian(0, epsilon) + lagrangian(until, epsilon)
    for (let i = 1; i < steps; i++) sum += (i % 2 ? 4 : 2) * lagrangian(i * dt, epsilon)
    return sum * dt / 3
}
