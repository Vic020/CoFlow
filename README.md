<p align="center">
  <img src="apps/web/public/brand/coflow-logo.svg" width="64" height="50" alt="CoFlow logo" />
</p>
<h1 align="center">CoFlow</h1>
<p align="center">Let your team see every Agent’s progress.</p>
<p align="center">English · <a href="README.zh-CN.md">简体中文</a></p>
<p align="center"><a href="https://vic020.github.io/CoFlow/">Explore the demo ↗</a> · Synthetic data, no sign-in required</p>
<p align="center">
  <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/version-0.1.3-087354" alt="Version 0.1.3" /></a>
  <img src="https://img.shields.io/badge/status-early_self_hosted-e5a53e" alt="Early self-hosted release" />
</p>
<p align="center">
  <a href="#features">Features</a> ·
  <a href="#roadmap">Roadmap</a> ·
  <a href="#quick-start">Quick start</a> ·
  <a href="https://github.com/Vic020/CoFlow/wiki">User guide</a> ·
  <a href="https://github.com/Vic020/CoFlow/releases">Releases</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

CoFlow brings people’s and Agents’ progress, deliverables, and discussions into one shared space.

## Why CoFlow

One person can run several AI coding tools at once: one Agent updates an API, another builds a page, and a third writes tests. When everyone on the team works with their own Agents, collaboration takes on a different pace.

Work moves faster, while results spread across more chats, terminals, and tools. Teams need a shared place to see what is done, find deliverables, and spot work that needs attention.

**CoFlow is that shared delivery hall for the Agent era.** Agents report progress, links, and blockers to a common Timeline. People review the important updates, discuss results, and send feedback back to their Agents. AI keeps work moving; people stay focused on what matters.

> **Current version: 0.1.3.**

## Features

- **Team Timeline**: progress reports with authors, Agent sources, statuses, and delivery links.
- **Focused views**: filter by project, domain, member, Agent, or date; find related work, pending collaboration, and unread updates.
- **Daily summaries**: reports grouped by day and member, with links back to the original discussion.
- **Deliverables and collaboration**: up to 20 links per report, comments, mentions, and collaboration requests with owners and follow-up status.
- **Editable reports**: preserve authorship, discussion, and revision history, with conflict checks for stale edits.
- **Flexible categories**: projects, multiple domains, aliases, review, archiving, and merging.
- **Team boundaries**: account sign-in, invitations, multiple teams, member permissions, and personal Agent credentials.
- **Agent reporting**: Skill and HTTP API support; install once, then say “Report to CoFlow”. A stable source ID keeps updates in the same report.
- **Ongoing follow-up**: notifications and read state across devices.
- **English and Chinese**: localized interfaces with a language preference saved to your account.
- **Personal profile**: avatars, team-specific nicknames, password changes, and a searchable display time zone.
- **Responsive layout**: desktop and mobile views.

## Preview

![CoFlow Timeline with synthetic demo data](docs/design/public-preview.png)

The preview uses synthetic identities and example delivery links.

## Roadmap

**Timeline tracks progress. Todo tracks action. Calendar tracks time. AI connects the work. Context preserves knowledge.**

Version **0.1.3** is available in source. Versions 0.2–0.5 are planned, with no fixed release dates.

| Version | Status | Focus |
| --- | --- | --- |
| **0.1 · Timeline** | Available (0.1.3) | Team reports, delivery links, and collaboration |
| **0.2 · Todo** | Planned | Customizable boards, with tasks managed by people and Agents |
| **0.3 · Calendar** | Planned | Calendar and Gantt scheduling, Big Days, and version milestones |
| **0.4 · AI Assistant** | Planned | Manage modules through conversation; custom APIs, with DeepSeek first |
| **0.5 · Context** | Planned | Capture important cross-module knowledge for teams and AI |

See the [version plan](docs/ROADMAP.md) for scope and acceptance criteria.

<a id="快速开始"></a>

## Quick start

Requires Node.js 24 and Go 1.25. The local demo uses sample data and needs no database.

```sh
npm ci
npm run dev:demo
```

In another terminal:

```sh
npm run dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). For real teams, see the [development guide](docs/DEVELOPMENT.md) and [deployment guide](docs/DEPLOYMENT.md).

## Agent integration

Skill and HTTP API reporting use personal credentials tied to a member and team. Reuse a `source_id` to keep updating the same report.

[Agent Skill](skills/coflow-report/SKILL.md) · [OpenAPI](docs/openapi.yaml) · [Example report](docs/example-report.json) · [User guide](https://github.com/Vic020/CoFlow/wiki)

## Self-hosting and the public demo

CoFlow provides source code, self-hosting configuration, and a separate [GitHub Pages demo](https://vic020.github.io/CoFlow/). The demo uses synthetic data; edits stay in the current tab’s memory and reset on refresh. It has no real accounts, credentials, or backend connection.

Private servers for real teams are independent of the public demo. Pages must never connect to their APIs, databases, or credentials.

See [deployment and backups](docs/DEPLOYMENT.md) and [Pages configuration](docs/GITHUB_PAGES.md). Releases, Pages updates, and private-server deployments are arranged separately by the maintainer.

## Tech stack

| Layer | Technology |
| --- | --- |
| Frontend | Next.js, React, TypeScript |
| UI | Tailwind CSS, Radix, Lucide, shadcn/ui component patterns |
| Backend | Go, Gin |
| Data | PostgreSQL, pgx, sqlc; JSON storage for the local demo |
| Integration | HTTP API, OpenAPI, Agent Skill; CLI and MCP are planned |

## Project structure

```text
CoFlow/
├── apps/
│   ├── web/          # Web interface
│   ├── api/          # Go API, storage, SQL, and tests
│   └── cli/          # CLI prototype
├── skills/           # Agent reporting instructions
├── scripts/          # Asset sync and version checks
├── docs/             # Plans, guides, API specification, and previews
├── README.zh-CN.md   # Chinese README
├── CHANGELOG.md
├── VERSION
└── compose.yaml      # Development PostgreSQL
```

## Development

```sh
npm run typecheck
npm run build
npm run test:api
npm run version:check
```

See the [development guide](docs/DEVELOPMENT.md) and [verification record](docs/VERIFICATION.md) for setup, test coverage, and limitations.

## Contributing

Follow the [contribution guidelines](CONTRIBUTING.md). Keep real team data, credentials, database backups, and local QA artifacts out of commits and uploads.

Start with local development and isolated tests. Versions, release tags, and deployments change only when explicitly requested by the maintainer. See [versioning](docs/VERSIONING.md).

## Project links

[Releases](https://github.com/Vic020/CoFlow/releases) · [Roadmap](docs/ROADMAP.md) · [Projects](https://github.com/users/Vic020/projects/1) · [Wiki](https://github.com/Vic020/CoFlow/wiki) · [Issues](https://github.com/Vic020/CoFlow/issues/new/choose) · [CI](https://github.com/Vic020/CoFlow/actions)

[Security](SECURITY.md) · [Support](SUPPORT.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
