#!/usr/bin/env bun
/**
 * Refreshes leaderboard.json with live interaction counts.
 *
 * Data sources:
 *   - GitHub Search API (30 req/min): issues/PRs authored and commented
 *   - AlgoChat: SQLite query on corvid-agent.db
 *
 * Usage: bun run scripts/refresh.ts [--db /path/to/corvid-agent.db]
 *
 * Counts:
 *   authored  = issues created + PRs created (separate queries to avoid 1000 cap)
 *   commented = issues/PRs where user left comments (--commenter)
 *   total_count = authored + commented + algochat messages
 *   github message_count = commented (issues/PRs with comments by user)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Database } from 'bun:sqlite';

const ROOT = join(import.meta.dir, '..');
const DATA_PATH = join(ROOT, 'data', 'leaderboard.json');

const dbFlag = process.argv.indexOf('--db');
const DB_PATH = dbFlag >= 0 && process.argv[dbFlag + 1]
    ? process.argv[dbFlag + 1]
    : join(ROOT, '..', 'corvid-agent', 'corvid-agent.db');

interface Entry {
    id: string;
    identifiers: {
        algorand_address: string;
        github_username?: string | null;
    };
    trust: { level: string; score: number; reason?: string | null };
    interactions: {
        total_count: number;
        first_seen: string;
        last_seen: string;
        channels?: Record<string, { message_count: number; last_active: string | null }>;
    };
    flags?: Array<{ type: string; description: string; timestamp: string }>;
    notes?: string;
    on_chain?: unknown;
}

interface Leaderboard {
    version: string;
    generated_at: string;
    entries: Entry[];
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function ghSearch(cmd: 'issues' | 'prs', args: string[]): Promise<{ count: number; lastDate: string | null }> {
    const proc = Bun.spawn([
        'gh', 'search', cmd, ...args,
        '--json', 'updatedAt,createdAt',
        '--limit', '1000',
    ], { stdout: 'pipe', stderr: 'pipe' });
    const out = await new Response(proc.stdout).text();
    const err = await new Response(proc.stderr).text();
    const code = await proc.exited;

    if (code !== 0) {
        if (err.includes('rate limit')) {
            console.warn('    ⚠ Rate limited — waiting 65s...');
            await Bun.sleep(65_000);
            return ghSearch(cmd, args);
        }
        return { count: 0, lastDate: null };
    }

    try {
        const items = JSON.parse(out) as Array<{ updatedAt?: string; createdAt?: string }>;
        const dates = items.map(i => i.updatedAt || i.createdAt).filter(Boolean).sort().reverse();
        return { count: items.length, lastDate: dates[0] ?? null };
    } catch {
        return { count: 0, lastDate: null };
    }
}

const PAUSE = () => Bun.sleep(2200); // Stay under 30 req/min

interface GitHubCounts {
    issuesAuthored: number;
    prsAuthored: number;
    commented: number;
    lastActive: string | null;
}

async function getGitHubCounts(username: string): Promise<GitHubCounts> {
    // 1. Issues authored (gh search issues → issues only)
    const issues = await ghSearch('issues', [
        '--author', username,
        '--owner', 'CorvidLabs', '--owner', 'corvid-agent',
    ]);
    await PAUSE();

    // 2. PRs authored (gh search prs → PRs only)
    const prs = await ghSearch('prs', [
        '--author', username,
        '--owner', 'CorvidLabs', '--owner', 'corvid-agent',
    ]);
    await PAUSE();

    // 3. Issues/PRs where user commented
    const commented = await ghSearch('issues', [
        '--commenter', username,
        '--include-prs',
        '--owner', 'CorvidLabs', '--owner', 'corvid-agent',
    ]);
    await PAUSE();

    const dates = [issues.lastDate, prs.lastDate, commented.lastDate].filter(Boolean).sort().reverse();

    return {
        issuesAuthored: issues.count,
        prsAuthored: prs.count,
        commented: commented.count,
        lastActive: dates[0] ?? null,
    };
}

function getAlgoChatStats(): Map<string, { messageCount: number; lastActive: string }> {
    const map = new Map<string, { messageCount: number; lastActive: string }>();
    if (!existsSync(DB_PATH)) {
        console.warn(`  ⚠ DB not found at ${DB_PATH}`);
        return map;
    }
    try {
        const db = new Database(DB_PATH, { readonly: true });
        const rows = db.query(
            'SELECT participant, COUNT(*) as msg_count, MAX(created_at) as last_active FROM algochat_messages GROUP BY participant',
        ).all() as Array<{ participant: string; msg_count: number; last_active: string }>;
        db.close();
        for (const row of rows) {
            map.set(row.participant, { messageCount: row.msg_count, lastActive: row.last_active });
        }
    } catch (err) {
        console.warn(`  ⚠ Could not read AlgoChat DB: ${err}`);
    }
    return map;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
    const raw = readFileSync(DATA_PATH, 'utf-8');
    const data: Leaderboard = JSON.parse(raw);

    console.log(`Refreshing ${data.entries.length} entries...\n`);

    // AlgoChat (local, instant)
    const algochatStats = getAlgoChatStats();
    console.log(`  AlgoChat DB: ${algochatStats.size} participants`);

    // GitHub users (skip bots and Copilot)
    const ghUsers = data.entries
        .map(e => e.identifiers.github_username)
        .filter((u): u is string => !!u && u !== 'Copilot' && !u.endsWith('[bot]'));

    // 3 search queries per user → need 3 × users quota
    const needed = ghUsers.length * 3;
    const rateProc = Bun.spawn(['gh', 'api', 'rate_limit', '--jq', '.resources.search.remaining'],
        { stdout: 'pipe', stderr: 'pipe' });
    const remaining = parseInt((await new Response(rateProc.stdout).text()).trim(), 10);
    await rateProc.exited;
    console.log(`  Search API: ${remaining}/30 remaining (need ~${needed})\n`);

    // Query each user
    const ghStats = new Map<string, GitHubCounts>();
    for (const username of ghUsers) {
        process.stdout.write(`  ${username}: `);
        const counts = await getGitHubCounts(username);
        ghStats.set(username, counts);
        const authored = counts.issuesAuthored + counts.prsAuthored;
        console.log(`${counts.issuesAuthored} issues + ${counts.prsAuthored} PRs authored, ${counts.commented} commented (total: ${authored + counts.commented})`);
    }

    console.log('');

    // Apply updates
    let countChanges = 0;
    for (const entry of data.entries) {
        const username = entry.identifiers.github_username;
        const algoAddr = entry.identifiers.algorand_address;
        if (!entry.interactions.channels) entry.interactions.channels = {};

        let ghAuthored = 0;

        // ── GitHub ───────────────────────────────────────────────────────
        if (username && ghStats.has(username)) {
            const gh = ghStats.get(username)!;
            ghAuthored = gh.issuesAuthored + gh.prsAuthored;
            const oldCommented = entry.interactions.channels.github?.message_count ?? 0;

            entry.interactions.channels.github = {
                message_count: gh.commented,
                last_active: gh.lastActive,
            };

            if (gh.commented !== oldCommented) countChanges++;

            // Update notes
            if (entry.notes) {
                entry.notes = entry.notes
                    .replace(/\d+ total GitHub interactions/, `${ghAuthored + gh.commented} total GitHub interactions`)
                    .replace(/\d+ authored/, `${ghAuthored} authored`)
                    .replace(/\d+ commented/, `${gh.commented} commented`)
                    .replace(/\d+ issues\/PRs authored/, `${ghAuthored} issues/PRs authored`)
                    .replace(/\(\d+ issues, \d+ PRs\)/, `(${gh.issuesAuthored} issues, ${gh.prsAuthored} PRs)`);
            }
            if (entry.flags) {
                for (const flag of entry.flags) {
                    if (flag.description) {
                        flag.description = flag.description
                            .replace(/\d+ issues\/PRs authored/, `${ghAuthored} issues/PRs authored`)
                            .replace(/\(\d+ issues, \d+ PRs\)/, `(${gh.issuesAuthored} issues, ${gh.prsAuthored} PRs)`)
                            .replace(/\d+ comments? \(/, `${gh.commented} comments (`);
                    }
                }
            }
        }

        // ── AlgoChat ─────────────────────────────────────────────────────
        if (algoAddr && algochatStats.has(algoAddr)) {
            const ac = algochatStats.get(algoAddr)!;
            const oldCount = entry.interactions.channels.algochat?.message_count ?? 0;
            entry.interactions.channels.algochat = {
                message_count: ac.messageCount,
                last_active: ac.lastActive,
            };
            if (ac.messageCount !== oldCount) countChanges++;
        }

        // ── Totals ───────────────────────────────────────────────────────
        const acCount = entry.interactions.channels.algochat?.message_count ?? 0;
        const ghCommented = entry.interactions.channels.github?.message_count ?? 0;
        const oldTotal = entry.interactions.total_count;

        if (username && ghStats.has(username)) {
            entry.interactions.total_count = ghAuthored + ghCommented + acCount;
        } else if (algoAddr && algochatStats.has(algoAddr)) {
            entry.interactions.total_count = acCount;
        }

        if (entry.interactions.total_count !== oldTotal) {
            console.log(`  ${entry.id}: total ${oldTotal} → ${entry.interactions.total_count}`);
        }

        // ── last_seen ────────────────────────────────────────────────────
        const ts = [
            entry.interactions.last_seen,
            entry.interactions.channels.github?.last_active,
            entry.interactions.channels.algochat?.last_active,
        ].filter((t): t is string => !!t);
        if (ts.length > 0) entry.interactions.last_seen = ts.sort().reverse()[0];
    }

    data.generated_at = new Date().toISOString();
    writeFileSync(DATA_PATH, JSON.stringify(data, null, 2) + '\n');

    console.log(`\n✓ Updated ${DATA_PATH} (${countChanges} channel counts changed)`);
    console.log('Run `bun run scripts/generate.ts` to regenerate LEADERBOARD.md and docs.');
}

main().catch(err => {
    console.error('Fatal:', err);
    process.exit(1);
});
