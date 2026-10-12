/**
 * `@xcwds/plugin-timers`: the config factory and build entry (RFC 0001, decision 1).
 *
 * ```ts
 * import timers from '@xcwds/plugin-timers';
 * export default defineConfig({ brand, plugins: [shell({ sections }), timers({ page: '/utils/cooking-timer' })] });
 * ```
 */
import { definePlugin, descriptor } from '@xcwds/core';
import { CORE, NAME, resolveOptions, type TimersOptions } from './options.js';

export type { AlarmSetting, ResolvedTimersOptions, TimersOptions } from './options.js';
export {
	MAX_DURATION,
	MINUTE,
	add,
	formatDuration,
	parseTimer,
	pause,
	remaining,
	reset,
	ringing,
	running,
	start,
	timer,
	type TimerState
} from './timer.js';

export default descriptor<TimersOptions>(NAME);

/** Checks the options when the config loads, so a mistake fails the build, not the page. */
export const build = definePlugin((_app, options: TimersOptions) => void resolveOptions(options), {
	name: NAME,
	core: CORE,
	network: false
});
