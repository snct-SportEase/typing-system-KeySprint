import { expect, test } from '@playwright/test';

declare global {
	interface Window {
		publishCompetitionSnapshot(data: unknown): void;
	}
}

test('shows ranked scores on the monitoring screen after a match finishes', async ({ page }) => {
	await page.addInitScript(() => {
		const sockets: EventTarget[] = [];
		class MockWebSocket extends EventTarget {
			static readonly CONNECTING = 0;
			static readonly OPEN = 1;
			static readonly CLOSING = 2;
			static readonly CLOSED = 3;
			readyState = MockWebSocket.CONNECTING;

			constructor() {
				super();
				sockets.push(this);
				setTimeout(() => {
					this.readyState = MockWebSocket.OPEN;
					this.dispatchEvent(new Event('open'));
				}, 0);
			}

			send() {}
			close() {
				this.readyState = MockWebSocket.CLOSED;
				this.dispatchEvent(new Event('close'));
			}
		}

		Object.assign(window, {
			WebSocket: MockWebSocket,
			publishCompetitionSnapshot(data: object) {
				const socket = sockets[0];
				socket?.dispatchEvent(
					new MessageEvent('message', {
						data: JSON.stringify({ type: 'competition.snapshot', data })
					})
				);
			}
		});
	});

	await page.goto('/monitoring');
	const lanes = Array.from({ length: 6 }, (_, index) => ({
		laneNumber: index + 1,
		teamName: `${index + 1}年生`,
		representativeSource: `IS${index + 1}`,
		connected: true,
		ready: true,
		status: 'running',
		problemIndex: 0,
		problemCount: 36,
		displayText: 'テスト問題',
		reading: 'てすともんだい',
		romanizedText: 'tesutomondai',
		inputPosition: 0,
		correctTypes: 0,
		incorrectTypes: 0,
		completedProblems: 0,
		accuracy: 0,
		wpm: 0,
		rawScore: 0,
		score: 0,
		progress: 0,
		rank: null
	}));
	const snapshot = {
		matchNumber: 1,
		attemptNumber: 1,
		problemSetId: 'typing-main-01',
		problemSetVersion: 1,
		durationSeconds: 180,
		status: 'running',
		serverTime: Date.now(),
		startsAt: Date.now(),
		endsAt: Date.now() + 180_000,
		connectedCount: 6,
		readyCount: 6,
		lanes
	};

	await page.waitForFunction(() => document.querySelector('.monitor-summary .online'));
	await page.evaluate((data) => window.publishCompetitionSnapshot(data), snapshot);
	await expect(page.getByRole('table')).toHaveCount(0);

	const finishedSnapshot = {
		...snapshot,
		status: 'finished',
		endsAt: Date.now(),
		lanes: lanes.map((lane, index) => ({
			...lane,
			status: 'finished',
			score: (6 - index) * 100,
			rank: index + 1
		}))
	};
	await page.evaluate((data) => window.publishCompetitionSnapshot(data), finishedSnapshot);

	const results = page.getByRole('table');
	await expect(results).toBeVisible();
	await expect(results.locator('tbody tr')).toHaveCount(6);
	await expect(results.locator('tbody tr').first()).toContainText('1位');
	await expect(results.locator('tbody tr').first()).toContainText('600');
	await expect(results.locator('tbody tr').last()).toContainText('6位');
	await expect(results.locator('tbody tr').last()).toContainText('100');
});
