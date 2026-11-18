import { describe, expect, it } from 'vitest';
import { variables } from './env';

describe('runtime environment configuration', () => {
	it('declares only the existing private runtime variables', () => {
		expect(Object.keys(variables).sort()).toEqual([
			'ADMIN_PASSWORD',
			'ADMIN_USERNAME',
			'DATABASE_URL',
			'TOURNAMENT_NAME'
		]);
		for (const definition of Object.values(variables)) {
			expect(definition).not.toHaveProperty('public');
			expect(definition).not.toHaveProperty('static');
		}
	});

	it('preserves missing values for existing fallbacks and validation', async () => {
		for (const definition of Object.values(variables)) {
			expect(await definition.schema['~standard'].validate(undefined)).toEqual({
				value: undefined
			});
			expect(await definition.schema['~standard'].validate('')).toEqual({ value: '' });
			expect(await definition.schema['~standard'].validate('runtime-value')).toEqual({
				value: 'runtime-value'
			});
		}
	});
});
