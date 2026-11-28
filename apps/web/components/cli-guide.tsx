"use client";

import Link from "next/link";
import { ArrowRight, Download, Terminal } from "lucide-react";
import { DocsHeader } from "./docs-header";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { publicBasePath, publicDemo, repositoryURL } from "@/lib/runtime";

const sections = [
  ["download", "下载与安装"],
  ["connect", "连接团队"],
  ["commands", "常用命令"],
] as const;

export function CLIGuide() {
  const { t } = useI18n();
  return (
    <div className="collaboration-docs">
      <DocsHeader page="cli" />
      <div className="docs-layout">
        <aside className="docs-toc">
          <p>{t("本页目录")}</p>
          <nav aria-label={t("本页目录")}>
            {sections.map(([id, title]) => (
              <a key={id} href={`#${id}`}>
                {t(title)}
              </a>
            ))}
          </nav>
        </aside>
        <main className="docs-article cli-guide">
          <div className="docs-intro">
            <h1>CoFlow CLI</h1>
            <p>
              {t(
                "在终端查看任务、提交进展、管理排期和查找团队知识。你和 Agent 使用同一套命令。",
              )}
            </p>
          </div>
          <article>
            <section aria-labelledby="download">
              <h2 id="download">{t("下载与安装")}</h2>
              <div className="cli-download">
                <div>
                  <strong>{t("预编译包")}</strong>
                  <p>
                    {t(
                      "在 GitHub Release 中查看 Linux x64 和 Apple Silicon macOS 的归档与 SHA-256 校验文件。附件以各版本页面为准。",
                    )}
                  </p>
                </div>
                <Button asChild size="sm">
                  <a href={`${repositoryURL}/releases`}>
                    <Download size={15} />
                    {t("查看发布附件")}
                  </a>
                </Button>
              </div>
              <h3>{t("安装脚本")}</h3>
              <p>
                {t(
                  "下载安装脚本后运行。脚本会校验发布包，并把 coflow 安装到 ~/.coflow/bin。",
                )}
              </p>
              <p>
                <a
                  href={`${publicBasePath}/agent/install-cli.sh`}
                  download="install-cli.sh"
                >
                  {t("下载安装脚本")}
                </a>
              </p>
              <pre className="cli-snippet">
                <code>
                  {'bash install-cli.sh\nexport PATH="$HOME/.coflow/bin:$PATH"'}
                </code>
              </pre>
              <h3>{t("从源码安装")}</h3>
              <p>
                {t(
                  "在 CoFlow 仓库根目录运行。构建需要 Rust 1.83 或更新版本，安装后的 coflow 可独立运行。",
                )}
              </p>
              <pre className="cli-snippet">
                <code>
                  cargo install --path apps/cli --locked --root "$HOME/.coflow"
                </code>
              </pre>
              <p>
                <a href={`${repositoryURL}/blob/main/docs/CLI_RELEASE.md`}>
                  {t("查看归档校验说明")}
                </a>
              </p>
            </section>
            <section aria-labelledby="connect">
              <h2 id="connect">{t("连接团队")}</h2>
              <p>
                {t(
                  "将示例地址换成你的 CoFlow 团队站点。打开终端显示的网页，输入配对码并核对账号、空间和权限。默认只读。",
                )}
              </p>
              <pre className="cli-snippet">
                <code>
                  {
                    "export COFLOW_URL=https://coflow.example.com\ncoflow auth login\ncoflow whoami"
                  }
                </code>
              </pre>
              {publicDemo ? (
                <p>{t("公开演示仅供浏览。请在自己的 CoFlow 实例中登录。")}</p>
              ) : (
                <Button asChild variant="outline" size="sm">
                  <Link href="/credentials#cli-connection">
                    {t("打开 CLI 配对")} <ArrowRight size={14} />
                  </Link>
                </Button>
              )}
            </section>
            <section aria-labelledby="commands">
              <h2 id="commands">{t("常用命令")}</h2>
              <div className="cli-guide-commands">
                <div>
                  <Terminal size={16} />
                  <code>coflow todo list</code>
                  <span>{t("查看任务列表")}</span>
                </div>
                <div>
                  <Terminal size={16} />
                  <code>coflow help report upsert</code>
                  <span>{t("查看上报示例和权限要求")}</span>
                </div>
                <div>
                  <Terminal size={16} />
                  <code>coflow help --json</code>
                  <span>{t("让 Agent 读取命令、参数和权限")}</span>
                </div>
              </div>
              <p>
                {t(
                  "需要本人确认的操作可用 --prepare 生成草案，再到 Agent 凭证页审查并执行。",
                )}
              </p>
              <p>
                <a href={`${publicBasePath}/agent/coflow/references/cli.md`}>
                  {t("查看完整 CLI 使用说明")}
                </a>
                {" · "}
                <a href={`${publicBasePath}/agent/coflow/references/cli-commands.md`}>
                  {t("CLI 命令表")}
                </a>
              </p>
            </section>
          </article>
        </main>
      </div>
    </div>
  );
}
