# @xcwds/plugin-timers

Timers for an [@xcwds](https://github.com/xcwds/xcwds) app, extracted from xcwds.github.io's
cooking and coffee timers. They count against wall-clock end times, so they stay right when a
phone suspends the tab, and they're saved, so a reload resumes them. The app owns them, not a
page: on every page a finished timer rings, a running one keeps the screen awake, and an app
update waits until they stop.

```ts
// xcwds.config.ts
import timers from '@xcwds/plugin-timers';

export default defineConfig({
	brand,
	plugins: [shell({ sections }), timers({ page: '/utils/timer' })]
});
```

```css
/* src/app.css, after Tailwind and the shell's styles */
@import '@xcwds/plugin-timers/styles.css';
```

```svelte
<!-- src/routes/+layout.svelte: finished timers show as alerts in the notification stack -->
<Shell>
	{@render children()}
	{#snippet notices()}<TimerAlert />{/snippet}
</Shell>

<!-- src/routes/utils/timer/+page.svelte -->
<main class="page-narrow"><TimerList /></main>
```

## Options

- **`page`**: the timers page (an app path), for the alert's Open link.
- **`storageKey`**: where timers are saved (default `app:timers:timers`). Set it to keep a key
  your app already uses, e.g. `app:cooking-timer:timers` for an app moving from xcwds.github.io's
  own code, which saves the same shape.

## What it adds

- **`app.timers`**:
  - `create(label, ms)` starts a timer of up to 7 days. Call it from a tap, so the alarm can
    play sound later on iOS.
  - `toggle(id)` pauses or resumes, `add(id, ms)` adds time (or snoozes a finished timer),
    `reset(id)` and `remove(id)`.
  - `list()`, `get(id)`, `remaining(item)`, `ringing(item)`, `anyRunning()` and `now()`.
  - `subscribe(listener)` calls back on every change and on each tick while a timer runs.
  - `show()` says a page lists every timer, so `<TimerAlert>` stays out of the way.
    Recipe step timers and other plugins use the same timers.
- **The alarm:** a finished timer beeps (Web Audio) and vibrates every 3 seconds until it's
  stopped or snoozed.
- **The `alarm` setting:** `{ sound, vibration, keepAwake }`, all on by default, in the
  `timers` settings section. `keepAwake` holds a screen wake lock while a timer runs.
- **An `onBeforeReload` reason**, `running timers`, so `@xcwds/plugin-update`'s banner asks
  to finish first.
- **Components:**
  - `TimerList.svelte`: every timer, plus a form to start one.
  - `Countdown.svelte`: one timer's remaining time, `<Countdown id={item.id} />`.
  - `TimerAlert.svelte`: finished timers with +1 min, Stop and Open (`openLabel` names the Open
    link for screen readers; defaults to "Open timers").
  - Each timer records the page it was started on (`path`). While
    [`@xcwds/plugin-lock`](../plugin-lock) has the app locked, a timer started on a page it keeps
    out shows `privateText` instead of its label ("Timer finished" in `TimerAlert`, "Private
    timer" in `TimerList`), and still rings, snoozes and stops.
- **Pure functions** from the main entry (`start`, `pause`, `add`, `remaining`,
  `formatDuration` and others) for tests and custom timers.
