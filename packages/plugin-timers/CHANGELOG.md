# @xcwds/plugin-timers

## 1.0.0

### Minor Changes

- 336f9d0: Timers that count against wall-clock end times and are saved, so they survive a backgrounded
  tab and a reload; the app owns them, so they ring, keep the screen awake and hold off updates on
  every page. With `TimerList`, `Countdown` and `TimerAlert` components and an `alarm` setting.

### Patch Changes

- 1924274: `<html data-hydrated>` is set once the app has booted, so tests that wait for it never act before
  plugins follow the browser's events. `<TimerAlert>` no longer re-renders itself in a loop while a
  timer rings, and takes an `openLabel` for its Open link. The config also loads in a fresh checkout, before `svelte-kit sync` has written the
  `.svelte-kit/tsconfig.json` an app's tsconfig extends.
- 71e1cf1: With `@xcwds/plugin-settings`, these plugins show up on the settings page: the theme and timer
  alarm as built-in controls, the shell's nav setting with `NavPicker`, and the install card at the
  top.
- 1d8bbc1: The repository moved to [xcwds/xcwds](https://github.com/xcwds/xcwds): package metadata, READMEs and
  the README of apps made with `npm create @xcwds` link there.
- Updated dependencies [94e846b]
- Updated dependencies [9cb54f8]
- Updated dependencies [71e1cf1]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [1924274]
- Updated dependencies [058e876]
- Updated dependencies [8c78037]
- Updated dependencies [71e1cf1]
- Updated dependencies [b03ad2e]
- Updated dependencies [1d8bbc1]
- Updated dependencies [71e1cf1]
- Updated dependencies [8c78037]
- Updated dependencies [94e846b]
- Updated dependencies [d1dd001]
- Updated dependencies [058e876]
- Updated dependencies [28d0b17]
- Updated dependencies [e8d705f]
  - @xcwds/core@0.1.0
  - @xcwds/sveltekit@0.1.0
  - @xcwds/plugin-shell@1.0.0
