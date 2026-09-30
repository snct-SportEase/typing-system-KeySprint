<script lang="ts">
	import { onMount } from 'svelte';
	import PublicHeader from '$lib/components/PublicHeader.svelte';
	import {
		webSocketUrl,
		type CompetitionServerMessage,
		type CompetitionSnapshot,
		type LaneSnapshot,
		type LaneStatus
	} from '$lib/competition/types';

	let { data } = $props();
	type OverallResult = {
		teamName: string;
		totalScore: number;
		rawScoreTotal: number;
		accuracyAverage: number;
		incorrectTypesTotal: number;
		rank: number;
	};

	let selectedMatch = $state(1);
	let showOverall = $state(false);
	let matchSnapshots = $state<Record<number, CompetitionSnapshot | null>>({
		1: null,
		2: null,
		3: null
	});
	let connectionStates = $state<Record<number, 'connecting' | 'connected' | 'disconnected'>>({
		1: 'connecting',
		2: 'connecting',
		3: 'connecting'
	});
	let clockOffsets = $state<Record<number, number>>({ 1: 0, 2: 0, 3: 0 });
	let now = $state(Date.now());
	let webSockets: Record<number, WebSocket | null> = { 1: null, 2: null, 3: null };
	let reconnectTimers: Record<number, ReturnType<typeof setTimeout> | undefined> = {};
	let stopped = false;

	let snapshot = $derived(matchSnapshots[selectedMatch]);
	let connectionState = $derived.by(() => {
		const states = showOverall
			? [1, 2, 3].map((matchNumber) => connectionStates[matchNumber])
			: [connectionStates[selectedMatch]];
		if (states.every((state) => state === 'connected')) return 'connected';
		if (states.some((state) => state === 'connecting')) return 'connecting';
		return 'disconnected';
	});
	let lanes = $derived(
		snapshot?.matchNumber === selectedMatch
			? snapshot.lanes
			: data.assignments
					.filter((assignment) => assignment.matchNumber === selectedMatch)
					.map(emptyLane)
	);
	let finalResults = $derived(
		snapshot?.matchNumber === selectedMatch && snapshot.status === 'finished'
			? [...lanes].sort((left, right) => {
					return (
						(left.rank ?? Number.POSITIVE_INFINITY) - (right.rank ?? Number.POSITIVE_INFINITY) ||
						left.laneNumber - right.laneNumber
					);
				})
			: null
	);
	let overallResults = $derived.by(() => {
		const snapshots = [1, 2, 3].map((matchNumber) => matchSnapshots[matchNumber]);
		if (!snapshots.every((result) => result?.status === 'finished')) return null;

		const teamNames = [...new Set(data.assignments.map((assignment) => assignment.teamName))];
		const summaries = teamNames.map((teamName) => {
			const teamResults = snapshots.map((result) =>
				result?.lanes.find((lane) => lane.teamName === teamName)
			);
			if (teamResults.some((result) => !result)) return null;
			const results = teamResults as LaneSnapshot[];
			return {
				teamName,
				totalScore: results.reduce((total, result) => total + result.score, 0),
				rawScoreTotal: results.reduce((total, result) => total + result.rawScore, 0),
				accuracyAverage:
					results.reduce((total, result) => total + result.accuracy, 0) / results.length,
				incorrectTypesTotal: results.reduce((total, result) => total + result.incorrectTypes, 0)
			};
		});
		if (summaries.some((summary) => !summary)) return null;

		const completeSummaries = summaries.filter((summary) => summary !== null);
		return completeSummaries
			.map((summary) => ({
				...summary,
				rank:
					1 +
					completeSummaries.filter((candidate) => compareOverallResults(candidate, summary) < 0)
						.length
			}))
			.sort(
				(left, right) =>
					compareOverallResults(left, right) || left.teamName.localeCompare(right.teamName, 'ja')
			);
	});

	function compareOverallResults(
		left: Omit<OverallResult, 'rank'>,
		right: Omit<OverallResult, 'rank'>
	) {
		if (left.totalScore !== right.totalScore) return right.totalScore - left.totalScore;
		if (left.rawScoreTotal !== right.rawScoreTotal) return right.rawScoreTotal - left.rawScoreTotal;
		if (left.accuracyAverage !== right.accuracyAverage) {
			return right.accuracyAverage - left.accuracyAverage;
		}
		return left.incorrectTypesTotal - right.incorrectTypesTotal;
	}

	onMount(() => {
		const clock = setInterval(() => (now = Date.now()), 100);
		for (const matchNumber of [1, 2, 3]) connect(matchNumber);
		return () => {
			stopped = true;
			clearInterval(clock);
			for (const timer of Object.values(reconnectTimers)) clearTimeout(timer);
			for (const socket of Object.values(webSockets)) socket?.close();
		};
	});

	function connect(matchNumber: number) {
		connectionStates[matchNumber] = 'connecting';
		const socket = new WebSocket(webSocketUrl());
		webSockets[matchNumber] = socket;
		socket.addEventListener('open', () => {
			if (webSockets[matchNumber] !== socket) return;
			connectionStates[matchNumber] = 'connected';
			socket.send(JSON.stringify({ type: 'monitor.subscribe', data: { matchNumber } }));
		});
		socket.addEventListener('message', (event) => {
			const message = JSON.parse(String(event.data)) as CompetitionServerMessage;
			if (message.type !== 'competition.snapshot') return;
			if (message.data.matchNumber !== matchNumber) return;
			matchSnapshots[matchNumber] = message.data;
			clockOffsets[matchNumber] = message.data.serverTime - Date.now();
		});
		socket.addEventListener('close', () => {
			if (webSockets[matchNumber] !== socket) return;
			connectionStates[matchNumber] = 'disconnected';
			if (!stopped) reconnectTimers[matchNumber] = setTimeout(() => connect(matchNumber), 1_000);
		});
	}

	function selectMatch(matchNumber: number) {
		selectedMatch = matchNumber;
		showOverall = false;
	}

	function selectOverall() {
		showOverall = true;
	}

	function remainingSeconds() {
		if (!snapshot?.endsAt) return snapshot?.durationSeconds ?? 180;
		return Math.max(0, Math.ceil((snapshot.endsAt - (now + clockOffsets[selectedMatch])) / 1_000));
	}

	function formatTime(seconds: number) {
		return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
	}

	function statusLabel(status: LaneStatus) {
		return {
			disconnected: '未接続',
			connected: '接続済み',
			ready: '準備完了',
			countdown: '開始待機',
			running: '競技中',
			finished: '終了',
			interrupted: '中断',
			force_finished: '強制終了',
			invalidated: '無効'
		}[status];
	}

	function emptyLane(assignment: (typeof data.assignments)[number]): LaneSnapshot {
		return {
			laneNumber: assignment.laneNumber,
			teamName: assignment.teamName,
			representativeSource: assignment.representativeSource,
			connected: false,
			ready: false,
			status: 'disconnected',
			problemIndex: 0,
			problemCount: 36,
			displayText: '待機中',
			reading: '',
			romanizedText: '',
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
		};
	}
</script>

<svelte:head>
	<title>モニタリング | {data.tournamentName}</title>
	<meta name="description" content={`${data.tournamentName}の競技モニタリング画面`} />
</svelte:head>

<PublicHeader tournamentName={data.tournamentName} current="monitoring" />

<main class="monitor-main">
	<div class="monitor-toolbar">
		<div class="match-tabs" role="tablist" aria-label="試合">
			{#each [1, 2, 3] as matchNumber (matchNumber)}
				<button
					type="button"
					role="tab"
					aria-selected={!showOverall && selectedMatch === matchNumber}
					class:is-active={!showOverall && selectedMatch === matchNumber}
					onclick={() => selectMatch(matchNumber)}>第{matchNumber}試合</button
				>
			{/each}
			{#if overallResults}
				<button
					type="button"
					role="tab"
					aria-selected={showOverall}
					class:is-active={showOverall}
					onclick={selectOverall}>総合</button
				>
			{/if}
		</div>
		<div class="monitor-summary" aria-live="polite">
			{#if showOverall}
				<strong>3試合終了</strong>
			{:else}
				<span class:online={connectionState === 'connected'}
					>{connectionState === 'connected' ? 'LIVE' : 'OFFLINE'}</span
				>
				<strong>{snapshot?.readyCount ?? 0}/6 準備</strong>
				<time>{formatTime(remainingSeconds())}</time>
			{/if}
		</div>
	</div>

	{#if showOverall}
		{#if overallResults}
			<section
				class="monitor-final-results"
				aria-labelledby="monitor-overall-results-title"
				aria-live="polite"
			>
				<h1 id="monitor-overall-results-title">3試合 総合結果</h1>
				<div class="monitor-results-scroll">
					<table class="monitor-results-table">
						<thead>
							<tr>
								<th scope="col">順位</th>
								<th scope="col">学年</th>
								<th scope="col">総合スコア</th>
							</tr>
						</thead>
						<tbody>
							{#each overallResults as result (result.teamName)}
								<tr>
									<td class="monitor-result-rank">{result.rank}位</td>
									<th scope="row">{result.teamName}</th>
									<td class="monitor-result-score">{result.totalScore}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{:else}
			<section class="empty-state">
				<h1>総合結果</h1>
				<p>第1〜第3試合がすべて終了すると表示されます。</p>
			</section>
		{/if}
	{:else if lanes.length === 0}
		<section class="empty-state">
			<h1>第{selectedMatch}試合</h1>
			<p>試合情報はまだ設定されていません。</p>
		</section>
	{:else}
		{#if finalResults}
			<section
				class="monitor-final-results"
				aria-labelledby="monitor-final-results-title"
				aria-live="polite"
			>
				<h1 id="monitor-final-results-title">第{selectedMatch}試合 最終結果</h1>
				<div class="monitor-results-scroll">
					<table class="monitor-results-table">
						<thead>
							<tr>
								<th scope="col">順位</th>
								<th scope="col">レーン</th>
								<th scope="col">出場クラス</th>
								<th scope="col">選出元</th>
								<th scope="col">スコア</th>
							</tr>
						</thead>
						<tbody>
							{#each finalResults as lane (lane.laneNumber)}
								<tr>
									<td class="monitor-result-rank">{lane.rank ?? '—'}位</td>
									<td>{lane.laneNumber}</td>
									<th scope="row">{lane.teamName}</th>
									<td>{lane.representativeSource}</td>
									<td class="monitor-result-score">{lane.score}</td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			</section>
		{:else}
			<div class="monitor-grid" aria-label={`第${selectedMatch}試合 競技状況`}>
				{#each lanes as lane (lane.laneNumber)}
					<section
						class="monitor-lane"
						class:is-running={lane.status === 'running'}
						aria-label={`レーン${lane.laneNumber} ${lane.teamName}`}
					>
						<header>
							<div class="lane-identity">
								<strong class="monitor-lane-number">{lane.laneNumber}</strong>
								<div>
									<h2>{lane.teamName}</h2>
									<p>{lane.representativeSource}</p>
								</div>
							</div>
							<div class={`lane-status status-${lane.status}`}>
								<span>{statusLabel(lane.status)}</span>
								{#if lane.rank}<strong>{lane.rank}位</strong>{/if}
							</div>
						</header>

						<div class="monitor-problem">
							<p>{lane.displayText}</p>
							<div class="monitor-roman">
								<span>{lane.romanizedText.slice(0, lane.inputPosition)}</span
								>{lane.romanizedText.slice(lane.inputPosition)}
							</div>
						</div>

						<div class="lane-progress" aria-label={`進捗 ${lane.progress.toFixed(0)}%`}>
							<span style={`width: ${lane.progress}%`}></span>
						</div>
						<dl class="monitor-metrics">
							<div>
								<dt>正タイプ</dt>
								<dd>{lane.correctTypes}</dd>
							</div>
							<div>
								<dt>ミス</dt>
								<dd>{lane.incorrectTypes}</dd>
							</div>
							<div>
								<dt>速度</dt>
								<dd>{lane.wpm.toFixed(0)}</dd>
							</div>
							<div>
								<dt>正確率</dt>
								<dd>{(lane.accuracy * 100).toFixed(1)}%</dd>
							</div>
						</dl>
					</section>
				{/each}
			</div>
		{/if}
	{/if}
</main>
