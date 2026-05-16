<template>
    <div class="experience-fx" aria-hidden="true">
        <div class="experience-fx__spotlight"></div>
        <div class="experience-fx__scanline"></div>
        <span
            v-for="ripple in ripples"
            :key="ripple.id"
            class="experience-fx__ripple"
            :style="ripple.style"
        ></span>
        <span
            v-for="pulse in wheelPulses"
            :key="pulse.id"
            class="experience-fx__wheel"
            :style="pulse.style"
        ></span>
        <span
            v-for="particle in particles"
            :key="particle.id"
            class="experience-fx__particle"
            :style="particle.style"
        ></span>
    </div>
</template>

<script setup lang="ts">
type FxItem = {
    id: number;
    timer: number;
    style: Record<string, string>;
};

const particles = Array.from({ length: 8 }, (_, index) => ({
    id: index,
    style: {
        "--delay": `${index * 0.7}s`,
        "--duration": `${12 + (index % 4) * 2.2}s`,
        "--left": `${5 + ((index * 17) % 90)}%`,
        "--size": `${3 + (index % 4)}px`,
    },
}));
const ripples = ref<FxItem[]>([]);
const wheelPulses = ref<FxItem[]>([]);
const prefersReducedMotion = ref(false);
let nextFxId = 0;
let lastWheelFx = 0;

onMounted(() => {
    prefersReducedMotion.value = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.addEventListener("pointerdown", addRipple, {
        passive: true,
    });
    window.addEventListener("wheel", addWheelPulse, {
        passive: true,
    });
});

onBeforeUnmount(() => {
    window.removeEventListener("pointerdown", addRipple);
    window.removeEventListener("wheel", addWheelPulse);
    clearFx(ripples.value);
    clearFx(wheelPulses.value);
});

function addRipple(event: PointerEvent): void {
    if (prefersReducedMotion.value) {
        return;
    }

    const id = nextFxId++;
    const item: FxItem = {
        id,
        style: {
            "--x": `${event.clientX}px`,
            "--y": `${event.clientY}px`,
        },
        timer: window.setTimeout(() => removeFxItem(ripples, id), 620),
    };

    ripples.value = [...ripples.value.slice(-5), item];
}

function addWheelPulse(event: WheelEvent): void {
    if (prefersReducedMotion.value) {
        return;
    }

    const now = performance.now();

    if (now - lastWheelFx < 120) {
        return;
    }

    lastWheelFx = now;
    const id = nextFxId++;
    const item: FxItem = {
        id,
        style: {
            "--direction": event.deltaY >= 0 ? "1" : "-1",
            "--x": `${event.clientX}px`,
            "--y": `${event.clientY}px`,
        },
        timer: window.setTimeout(() => removeFxItem(wheelPulses, id), 520),
    };

    wheelPulses.value = [...wheelPulses.value.slice(-3), item];
}

function removeFxItem(target: Ref<FxItem[]>, id: number): void {
    target.value = target.value.filter((item) => item.id !== id);
}

function clearFx(items: FxItem[]): void {
    for (const item of items) {
        window.clearTimeout(item.timer);
    }
}
</script>

<style scoped>
.experience-fx {
    inset: 0;
    overflow: hidden;
    pointer-events: none;
    position: fixed;
    z-index: 0;
}

.experience-fx__spotlight {
    background:
        radial-gradient(circle at var(--cursor-x, 50%) var(--cursor-y, 30%), rgba(211, 140, 255, 0.12), transparent 26%),
        radial-gradient(circle at 80% 10%, rgba(57, 216, 255, 0.08), transparent 28%);
    inset: 0;
    opacity: 0.72;
    position: absolute;
}

.experience-fx__scanline {
    animation: scanline 10s linear infinite;
    background: linear-gradient(180deg, transparent, rgba(57, 216, 255, 0.08), transparent);
    height: 120px;
    left: 0;
    position: absolute;
    right: 0;
    top: -180px;
}

.experience-fx__particle {
    animation: particle-rise var(--duration) linear infinite;
    animation-delay: var(--delay);
    background: color-mix(in srgb, var(--color-orchid) 70%, var(--color-sky));
    border-radius: 999px;
    box-shadow: 0 0 12px rgba(211, 140, 255, 0.46);
    height: var(--size);
    left: var(--left);
    opacity: 0;
    position: absolute;
    top: 100%;
    width: var(--size);
}

.experience-fx__ripple {
    animation: click-ripple 620ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.9), color-mix(in srgb, var(--color-orchid) 42%, transparent) 32%, transparent 70%);
    border: 1px solid color-mix(in srgb, var(--color-sky) 62%, transparent);
    border-radius: 999px;
    height: 18px;
    left: var(--x);
    position: absolute;
    top: var(--y);
    width: 18px;
}

.experience-fx__wheel {
    animation: wheel-pulse 520ms ease-out both;
    border: 1px solid color-mix(in srgb, var(--color-sky) 72%, transparent);
    border-radius: 999px;
    height: 34px;
    left: var(--x);
    position: absolute;
    top: var(--y);
    width: 18px;
}

.experience-fx__wheel::after {
    background: color-mix(in srgb, var(--color-orchid) 72%, var(--color-sky));
    border-radius: 999px;
    content: "";
    height: 8px;
    left: 50%;
    position: absolute;
    top: 7px;
    transform: translateX(-50%);
    width: 3px;
}

@keyframes particle-rise {
    0% {
        opacity: 0;
        transform: translate3d(0, 0, 0) scale(0.6);
    }

    14% {
        opacity: 0.78;
    }

    100% {
        opacity: 0;
        transform: translate3d(40px, -110vh, 0) scale(1.3);
    }
}

@keyframes click-ripple {
    0% {
        opacity: 0.92;
        transform: translate3d(-50%, -50%, 0) scale(0.45);
    }

    100% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0) scale(4.4);
    }
}

@keyframes wheel-pulse {
    0% {
        opacity: 0.86;
        transform: translate3d(-50%, -50%, 0) translateY(0) scale(0.88);
    }

    100% {
        opacity: 0;
        transform: translate3d(-50%, -50%, 0) translateY(calc(var(--direction) * 42px)) scale(1.18);
    }
}

@keyframes scanline {
    0% {
        transform: translateY(0);
    }

    100% {
        transform: translateY(calc(100vh + 180px));
    }
}

@media (prefers-reduced-motion: reduce) {
    .experience-fx__scanline,
    .experience-fx__ripple,
    .experience-fx__wheel,
    .experience-fx__particle {
        animation: none;
    }
}
</style>
