# Documentation

[简体中文](README.zh-CN.md)

CoFlow **0.1.4** · [English Wiki](https://github.com/Vic020/CoFlow/wiki) · [中文 Wiki](https://github.com/Vic020/CoFlow/wiki/Home-zh-CN)

Let your team see every Agent advance. CoFlow brings progress, deliverables and feedback from multiple Agents into one shared space.

The repository guides below are maintained in Chinese. The Wiki provides English and Chinese user guides; repository documentation covers development, protocols and operations in more detail.

| Goal | Guide |
| --- | --- |
| Start a team, report work and collaborate | [Usage / 使用指南](USAGE.md) |
| Install reporting for an Agent and reuse it | [Agent reporting / Agent 接入](AGENT_REPORTING.md) |
| Resolve login, invitation or reporting problems | [Troubleshooting / 排障](TROUBLESHOOTING.md) |
| Develop locally and run isolated tests | [Development / 开发](DEVELOPMENT.md) |
| Self-host, upgrade, back up and roll back | [Deployment / 部署](DEPLOYMENT.md) |
| Build the synthetic, offline public demo | [GitHub Pages](GITHUB_PAGES.md) |
| Maintain translations and display time zones | [Internationalization / 多语言](I18N.md) |
| Check the current product and future scope | [Product](PRODUCT.md) · [Roadmap](ROADMAP.md) |
| Run a team trial or inspect recorded checks | [Pilot checklist](PILOT.md) · [Verification](VERIFICATION.md) |
| Prepare a version or read release notes | [Versioning](VERSIONING.md) · [v0.1.4](releases/v0.1.4.md) · [Changelog](../CHANGELOG.md) |
| Build generic Docker images on GitHub | [Image builds](IMAGE_BUILDS.md) |
| Maintain docs, Wiki, Projects and releases | [Maintenance workflow](MAINTENANCE.md) |

## Protocol sources

- [Reporting Skill](../skills/coflow-report/SKILL.md): Agent installation, identity checks, reporting and recovery rules.
- [OpenAPI](openapi.yaml): request schemas, endpoints and permissions. API base path: `/api/v1`.
- [Synthetic report](example-report.json): a payload example; replace its source ID for a new work unit and reuse it for updates.

Download copies at `/agent/coflow-report/SKILL.md` and `/agent/openapi.yaml` are generated from these sources by `scripts/sync-agent-assets.mjs`.

## Boundaries

Self-hosted team mode uses PostgreSQL and real accounts. Local demo mode and GitHub Pages use separate synthetic data; Pages has no backend. Todo, Calendar, AI Assistant and Context are planned, not available in 0.1.4. Skill and HTTP API are supported; CLI and MCP are future integrations.

A source release, a Pages update and a private server deployment are separate, explicitly requested operations. Public documentation contains generic examples only. Keep deployment inventories, credentials, backups and real team data outside Git. See [Security](../SECURITY.md) and [Contributing](../CONTRIBUTING.md).
