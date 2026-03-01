#!/usr/bin/env bun
/**
 * Generates the markdown leaderboard and HTML site from leaderboard.json
 *
 * Usage: bun run scripts/generate.ts
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

const ROOT = join(import.meta.dir, '..');
const DATA_PATH = join(ROOT, 'data', 'leaderboard.json');
const DOCS_PATH = join(ROOT, 'docs');
const MD_PATH = join(ROOT, 'LEADERBOARD.md');

interface ChannelStats {
  message_count: number;
  last_active: string | null;
}

interface Entry {
  id: string;
  identifiers: {
    algorand_address: string;
    github_username?: string | null;
    nickname?: string | null;
    channel_handles?: Record<string, string>;
  };
  trust: {
    level: 'verified' | 'trusted' | 'neutral' | 'suspicious' | 'blocked';
    score: number;
    reason?: string | null;
  };
  interactions: {
    total_count: number;
    first_seen: string;
    last_seen: string;
    channels?: {
      algochat?: ChannelStats;
      github?: ChannelStats;
      agent_messages?: ChannelStats;
      web?: ChannelStats;
    };
  };
  flags?: Array<{
    type: string;
    description: string;
    timestamp: string;
    evidence_txid?: string | null;
  }>;
  on_chain?: {
    attestation_hash?: string | null;
    attestation_txid?: string | null;
    total_algo_transacted?: number | null;
  };
}

interface Leaderboard {
  version: string;
  generated_at: string;
  entries: Entry[];
}

const TRUST_BADGES: Record<string, string> = {
  verified: '🟢 Verified',
  trusted: '🔵 Trusted',
  neutral: '⚪ Neutral',
  suspicious: '🟡 Suspicious',
  blocked: '🔴 Blocked',
};

const FLAG_ICONS: Record<string, string> = {
  spam: '🚫',
  malicious: '☠️',
  scam: '⚠️',
  impersonation: '🎭',
  abuse: '🔥',
  positive_contribution: '⭐',
};

function shortAddr(addr: string): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toISOString().split('T')[0];
}

function identifierDisplay(entry: Entry): string {
  const parts: string[] = [];
  if (entry.identifiers.nickname) {
    parts.push(`**${entry.identifiers.nickname}**`);
  }
  if (entry.identifiers.github_username) {
    parts.push(`[@${entry.identifiers.github_username}](https://github.com/${entry.identifiers.github_username})`);
  }
  if (entry.identifiers.channel_handles) {
    for (const [channel, handle] of Object.entries(entry.identifiers.channel_handles)) {
      parts.push(`${channel}: ${handle}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : '—';
}

function generateMarkdown(data: Leaderboard): string {
  const sorted = [...data.entries].sort((a, b) => b.trust.score - a.trust.score);

  const lines: string[] = [
    '# CorvidAgent Reputation Leaderboard',
    '',
    `> Last updated: ${formatDate(data.generated_at)} · ${data.entries.length} entities tracked`,
    '',
    'Public reputation data for entities that interact with [CorvidAgent](https://github.com/CorvidLabs/corvid-agent) across AlgoChat, GitHub, and other channels.',
    '',
    '---',
    '',
  ];

  // Summary stats
  const byLevel: Record<string, number> = {};
  for (const e of data.entries) {
    byLevel[e.trust.level] = (byLevel[e.trust.level] || 0) + 1;
  }
  if (data.entries.length > 0) {
    lines.push('## Summary');
    lines.push('');
    lines.push('| Trust Level | Count |');
    lines.push('|---|---|');
    for (const level of ['verified', 'trusted', 'neutral', 'suspicious', 'blocked']) {
      if (byLevel[level]) {
        lines.push(`| ${TRUST_BADGES[level]} | ${byLevel[level]} |`);
      }
    }
    lines.push('');
    lines.push('---');
    lines.push('');
  }

  // Leaderboard table
  lines.push('## Leaderboard');
  lines.push('');

  if (sorted.length === 0) {
    lines.push('*No entries yet. Leaderboard will be populated as CorvidAgent interacts with the community.*');
    lines.push('');
  } else {
    lines.push('| Rank | Address | Identity | Trust | Score | Interactions | Last Seen | Flags |');
    lines.push('|---|---|---|---|---|---|---|---|');

    for (let i = 0; i < sorted.length; i++) {
      const e = sorted[i];
      const rank = i + 1;
      const addr = `\`${shortAddr(e.identifiers.algorand_address)}\``;
      const identity = identifierDisplay(e);
      const trust = TRUST_BADGES[e.trust.level] || e.trust.level;
      const score = `${e.trust.score}/100`;
      const interactions = e.interactions.total_count.toString();
      const lastSeen = formatDate(e.interactions.last_seen);
      const flags = (e.flags || [])
        .map(f => `${FLAG_ICONS[f.type] || '❓'} ${f.type}`)
        .join(', ') || '—';

      lines.push(`| ${rank} | ${addr} | ${identity} | ${trust} | ${score} | ${interactions} | ${lastSeen} | ${flags} |`);
    }
    lines.push('');
  }

  // Detailed entries
  if (sorted.length > 0) {
    lines.push('---');
    lines.push('');
    lines.push('## Detailed Profiles');
    lines.push('');

    for (const e of sorted) {
      lines.push(`### ${e.identifiers.nickname || shortAddr(e.identifiers.algorand_address)}`);
      lines.push('');
      lines.push(`- **Address:** \`${e.identifiers.algorand_address}\``);
      if (e.identifiers.github_username) {
        lines.push(`- **GitHub:** [@${e.identifiers.github_username}](https://github.com/${e.identifiers.github_username})`);
      }
      if (e.identifiers.channel_handles) {
        for (const [ch, handle] of Object.entries(e.identifiers.channel_handles)) {
          lines.push(`- **${ch}:** ${handle}`);
        }
      }
      lines.push(`- **Trust:** ${TRUST_BADGES[e.trust.level]} (${e.trust.score}/100)`);
      if (e.trust.reason) {
        lines.push(`- **Reason:** ${e.trust.reason}`);
      }
      lines.push(`- **Interactions:** ${e.interactions.total_count} total`);
      lines.push(`- **Active:** ${formatDate(e.interactions.first_seen)} → ${formatDate(e.interactions.last_seen)}`);

      // Channel breakdown
      if (e.interactions.channels) {
        const chans = e.interactions.channels;
        const parts: string[] = [];
        if (chans.algochat?.message_count) parts.push(`AlgoChat: ${chans.algochat.message_count}`);
        if (chans.github?.message_count) parts.push(`GitHub: ${chans.github.message_count}`);
        if (chans.agent_messages?.message_count) parts.push(`Agent: ${chans.agent_messages.message_count}`);
        if (chans.web?.message_count) parts.push(`Web: ${chans.web.message_count}`);
        if (parts.length > 0) {
          lines.push(`- **Channels:** ${parts.join(' · ')}`);
        }
      }

      // On-chain data
      if (e.on_chain?.total_algo_transacted != null) {
        lines.push(`- **ALGO transacted:** ${e.on_chain.total_algo_transacted.toFixed(3)} ALGO`);
      }
      if (e.on_chain?.attestation_txid) {
        lines.push(`- **Attestation:** [${e.on_chain.attestation_txid.slice(0, 12)}...](https://allo.info/tx/${e.on_chain.attestation_txid})`);
      }

      // Flags
      if (e.flags && e.flags.length > 0) {
        lines.push('- **Flags:**');
        for (const f of e.flags) {
          const evidence = f.evidence_txid
            ? ` ([proof](https://allo.info/tx/${f.evidence_txid}))`
            : '';
          lines.push(`  - ${FLAG_ICONS[f.type] || '❓'} ${f.description} (${formatDate(f.timestamp)})${evidence}`);
        }
      }
      lines.push('');
    }
  }

  // Footer
  lines.push('---');
  lines.push('');
  lines.push('*This leaderboard is automatically generated by [CorvidAgent](https://github.com/CorvidLabs/corvid-agent). Data is based on on-chain interactions and verifiable behavior. Algorand addresses are pseudonymous by default.*');
  lines.push('');

  return lines.join('\n');
}

function generateHTML(data: Leaderboard, markdown: string): string {
  const sorted = [...data.entries].sort((a, b) => b.trust.score - a.trust.score);

  const trustColors: Record<string, string> = {
    verified: '#22c55e',
    trusted: '#3b82f6',
    neutral: '#9ca3af',
    suspicious: '#eab308',
    blocked: '#ef4444',
  };

  const tableRows = sorted.map((e, i) => {
    const color = trustColors[e.trust.level] || '#9ca3af';
    const identity = e.identifiers.nickname
      || (e.identifiers.github_username ? `@${e.identifiers.github_username}` : '—');
    const ghLink = e.identifiers.github_username
      ? `<a href="https://github.com/${e.identifiers.github_username}" target="_blank">@${e.identifiers.github_username}</a>`
      : '';
    const flags = (e.flags || []).map(f => {
      const icon = FLAG_ICONS[f.type] || '❓';
      return `<span class="flag flag-${f.type}" title="${f.description}">${icon}</span>`;
    }).join(' ');

    return `
      <tr>
        <td class="rank">${i + 1}</td>
        <td class="address"><code>${shortAddr(e.identifiers.algorand_address)}</code></td>
        <td class="identity">${e.identifiers.nickname ? `<strong>${e.identifiers.nickname}</strong>` : ''} ${ghLink}</td>
        <td class="trust"><span class="trust-badge" style="--trust-color: ${color}">${e.trust.level}</span></td>
        <td class="score"><div class="score-bar"><div class="score-fill" style="width: ${e.trust.score}%; background: ${color}"></div><span>${e.trust.score}</span></div></td>
        <td class="interactions">${e.interactions.total_count}</td>
        <td class="last-seen">${formatDate(e.interactions.last_seen)}</td>
        <td class="flags">${flags || '—'}</td>
      </tr>`;
  }).join('\n');

  const emptyState = sorted.length === 0
    ? '<p class="empty-state">No entries yet. Leaderboard will be populated as CorvidAgent interacts with the community.</p>'
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>CorvidAgent Reputation Leaderboard</title>
  <meta name="description" content="Public reputation leaderboard for CorvidAgent interactions on Algorand">
  <style>
    :root {
      --bg: #0d1117;
      --surface: #161b22;
      --border: #30363d;
      --text: #e6edf3;
      --text-muted: #8b949e;
      --accent: #58a6ff;
      --verified: #22c55e;
      --trusted: #3b82f6;
      --neutral: #9ca3af;
      --suspicious: #eab308;
      --blocked: #ef4444;
    }

    * { margin: 0; padding: 0; box-sizing: border-box; }

    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
      background: var(--bg);
      color: var(--text);
      line-height: 1.6;
    }

    .container {
      max-width: 1200px;
      margin: 0 auto;
      padding: 2rem 1rem;
    }

    header {
      text-align: center;
      margin-bottom: 3rem;
    }

    header h1 {
      font-size: 2rem;
      margin-bottom: 0.5rem;
    }

    header h1 span { color: var(--accent); }

    header .subtitle {
      color: var(--text-muted);
      font-size: 0.95rem;
    }

    .meta {
      display: flex;
      justify-content: center;
      gap: 2rem;
      margin-top: 1rem;
      font-size: 0.85rem;
      color: var(--text-muted);
    }

    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 1rem;
      margin-bottom: 2rem;
    }

    .stat-card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 1rem;
      text-align: center;
    }

    .stat-card .value {
      font-size: 1.8rem;
      font-weight: 700;
    }

    .stat-card .label {
      font-size: 0.8rem;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 8px;
      overflow: hidden;
    }

    th, td {
      padding: 0.75rem 1rem;
      text-align: left;
      border-bottom: 1px solid var(--border);
    }

    th {
      background: rgba(255, 255, 255, 0.03);
      font-size: 0.8rem;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--text-muted);
      font-weight: 600;
    }

    tr:last-child td { border-bottom: none; }
    tr:hover td { background: rgba(255, 255, 255, 0.02); }

    .rank { font-weight: 700; color: var(--text-muted); width: 50px; }
    .address code {
      font-family: 'SF Mono', 'Fira Code', monospace;
      font-size: 0.85rem;
      background: rgba(255, 255, 255, 0.05);
      padding: 2px 6px;
      border-radius: 4px;
    }
    .identity a { color: var(--accent); text-decoration: none; }
    .identity a:hover { text-decoration: underline; }

    .trust-badge {
      display: inline-block;
      padding: 2px 10px;
      border-radius: 12px;
      font-size: 0.8rem;
      font-weight: 600;
      text-transform: capitalize;
      background: color-mix(in srgb, var(--trust-color) 15%, transparent);
      color: var(--trust-color);
      border: 1px solid color-mix(in srgb, var(--trust-color) 30%, transparent);
    }

    .score-bar {
      position: relative;
      height: 20px;
      background: rgba(255, 255, 255, 0.05);
      border-radius: 10px;
      min-width: 80px;
      overflow: hidden;
    }

    .score-fill {
      height: 100%;
      border-radius: 10px;
      transition: width 0.3s ease;
    }

    .score-bar span {
      position: absolute;
      right: 8px;
      top: 50%;
      transform: translateY(-50%);
      font-size: 0.75rem;
      font-weight: 700;
    }

    .flag {
      font-size: 1rem;
      cursor: help;
    }

    .empty-state {
      text-align: center;
      padding: 3rem;
      color: var(--text-muted);
      font-style: italic;
    }

    footer {
      text-align: center;
      margin-top: 3rem;
      padding-top: 2rem;
      border-top: 1px solid var(--border);
      color: var(--text-muted);
      font-size: 0.85rem;
    }

    footer a { color: var(--accent); text-decoration: none; }
    footer a:hover { text-decoration: underline; }

    @media (max-width: 768px) {
      .container { padding: 1rem 0.5rem; }
      th, td { padding: 0.5rem; font-size: 0.85rem; }
      .stats-grid { grid-template-columns: repeat(2, 1fr); }
      .meta { flex-direction: column; gap: 0.25rem; }
    }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1><span>Corvid</span>Agent Reputation</h1>
      <p class="subtitle">Public trust leaderboard for CorvidAgent interactions on Algorand</p>
      <div class="meta">
        <span>Last updated: ${formatDate(data.generated_at)}</span>
        <span>${data.entries.length} entities tracked</span>
        <span>v${data.version}</span>
      </div>
    </header>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="value">${data.entries.length}</div>
        <div class="label">Total Entities</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color: var(--verified)">${data.entries.filter(e => e.trust.level === 'verified').length}</div>
        <div class="label">Verified</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color: var(--trusted)">${data.entries.filter(e => e.trust.level === 'trusted').length}</div>
        <div class="label">Trusted</div>
      </div>
      <div class="stat-card">
        <div class="value" style="color: var(--suspicious)">${data.entries.filter(e => e.trust.level === 'suspicious' || e.trust.level === 'blocked').length}</div>
        <div class="label">Flagged</div>
      </div>
      <div class="stat-card">
        <div class="value">${data.entries.reduce((sum, e) => sum + e.interactions.total_count, 0)}</div>
        <div class="label">Total Interactions</div>
      </div>
    </div>

    ${emptyState}
    ${sorted.length > 0 ? `
    <table>
      <thead>
        <tr>
          <th>#</th>
          <th>Address</th>
          <th>Identity</th>
          <th>Trust</th>
          <th>Score</th>
          <th>Interactions</th>
          <th>Last Seen</th>
          <th>Flags</th>
        </tr>
      </thead>
      <tbody>
        ${tableRows}
      </tbody>
    </table>
    ` : ''}

    <footer>
      <p>Auto-generated by <a href="https://github.com/CorvidLabs/corvid-agent">CorvidAgent</a></p>
      <p>Data sourced from on-chain interactions. Algorand addresses are pseudonymous by default.</p>
      <p><a href="https://github.com/corvid-agent/corvid-reputation">View source &amp; raw data</a></p>
    </footer>
  </div>
</body>
</html>`;
}

// Main
const raw = readFileSync(DATA_PATH, 'utf-8');
const data: Leaderboard = JSON.parse(raw);

console.log(`Generating leaderboard from ${data.entries.length} entries...`);

// Generate markdown
const md = generateMarkdown(data);
writeFileSync(MD_PATH, md);
console.log(`  → ${MD_PATH}`);

// Generate HTML site
mkdirSync(DOCS_PATH, { recursive: true });
const html = generateHTML(data, md);
writeFileSync(join(DOCS_PATH, 'index.html'), html);
console.log(`  → ${join(DOCS_PATH, 'index.html')}`);

console.log('Done!');
