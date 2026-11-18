import { defineEnvVars } from '@sveltejs/kit/env';

export const variables = defineEnvVars({
	DATABASE_URL: { schema: (value) => value },
	TOURNAMENT_NAME: { schema: (value) => value },
	ADMIN_USERNAME: { schema: (value) => value },
	ADMIN_PASSWORD: { schema: (value) => value }
});
