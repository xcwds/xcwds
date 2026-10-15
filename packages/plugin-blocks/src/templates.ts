/**
 * Starter templates an app can offer under "Add from a template" (the plugin's `templates`
 * option takes these or its own). Adding one copies it with a new id, so changing a template
 * never changes apps already added.
 */
import { newId, parseApp, type AppDefinition } from './format.js';

export const water: AppDefinition = {
	format: 1,
	id: 'water',
	name: 'Water',
	emoji: '💧',
	private: false,
	blocks: [{ id: 'glasses', type: 'counter', label: 'Glasses today', goal: 8, reset: 'daily' }]
};

export const chores: AppDefinition = {
	format: 1,
	id: 'chores',
	name: 'Chores',
	emoji: '🧹',
	private: false,
	blocks: [
		{
			id: 'list',
			type: 'checklist',
			label: 'Chores',
			items: [
				{ id: 'dishes', label: 'Dishes', repeat: { repeat: 'daily' } },
				{ id: 'bins', label: 'Take out the bins', repeat: { repeat: 'weekly', weekdays: [1, 4] } },
				{ id: 'sheets', label: 'Change the sheets', repeat: { repeat: 'every', days: 14 } },
				{ id: 'plants', label: 'Water the plants', repeat: { repeat: 'every', days: 3 } }
			]
		}
	]
};

export const mood: AppDefinition = {
	format: 1,
	id: 'mood',
	name: 'Mood',
	emoji: '🌤️',
	private: true,
	blocks: [
		{
			id: 'log',
			type: 'log',
			label: 'Check-ins',
			fields: [
				{ id: 'mood', type: 'scale', label: 'Mood', max: 5, low: 'Low', high: 'Great' },
				{ id: 'slept', type: 'number', label: 'Sleep', unit: 'h', min: 0, max: 24 },
				{ id: 'note', type: 'text', label: 'Note' }
			]
		},
		{ id: 'notes', type: 'notes', label: 'Notes' }
	]
};

export const templates: AppDefinition[] = [water, chores, mood];

/** A copy of `template` with a new id, ready to save as one of your apps. */
export function fromTemplate(template: AppDefinition): AppDefinition {
	const parsed = parseApp(template);
	if (!parsed.ok) throw new Error(`Invalid template "${template.name}": ${parsed.error}`);
	return { ...parsed.value, id: newId() };
}
