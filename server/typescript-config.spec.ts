import { resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

describe('SvelteKit TypeScript configuration', () => {
	it('resolves generated types and includes application, server, config and browser tests', () => {
		const config = ts.getParsedCommandLineOfConfigFile(
			'tsconfig.json',
			{},
			{
				...ts.sys,
				onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
					throw new Error(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
				}
			}
		);

		expect(config?.errors).toEqual([]);
		expect(config?.options.types).toContain('$app/types');
		expect(config?.fileNames).toEqual(
			expect.arrayContaining(
				[
					'src/app.d.ts',
					'src/hooks.server.ts',
					'server/index.js',
					'server/realtime.spec.ts',
					'drizzle.config.ts',
					'vite.config.ts',
					'playwright.config.ts',
					'tests/system.e2e.ts'
				].map((file) => resolve(file))
			)
		);
	});
});
