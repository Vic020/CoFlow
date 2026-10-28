"use client";

import {
  Children,
  isValidElement,
  type ReactNode,
  useEffect,
  useState,
} from "react";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Check, Copy, Download } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CoFlowLogo } from "@/components/coflow-logo";
import { useI18n } from "@/components/i18n-provider";
import { Button } from "@/components/ui/button";
import { publicBasePath, repositoryURL, publicDemo } from "@/lib/runtime";
import { coflowSkillVersion } from "@/lib/skill-version";

function plainText(children: ReactNode): string {
  return Children.toArray(children)
    .map((child) =>
      isValidElement<{ children?: ReactNode }>(child)
        ? plainText(child.props.children)
        : String(child),
    )
    .join("");
}
const anchor = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}_\s-]/gu, "")
    .replace(/\s/g, "-");

function CodeBlock({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const value = plainText(children);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  const code = Children.toArray(children)[0];
  if (
    isValidElement<{ className?: string }>(code) &&
    code.props.className === "language-mermaid"
  ) {
    const steps = [...value.matchAll(/\b[A-Z]\[([^\]]+)\]/g)].map(
      (match) => match[1],
    );
    return (
      <div className="docs-flow-diagram">
        <ol className="docs-flow">
          {steps.map((step, index) => (
            <li key={step}>
              <span>{index + 1}</span>
              {step}
              {index < steps.length - 1 && (
                <ArrowRight size={14} aria-hidden="true" />
              )}
            </li>
          ))}
        </ol>
        <p>{t("需要继续完善时回到推进，达到约定标准再确认完成。")}</p>
      </div>
    );
  }
  return (
    <div className="docs-code">
      <Button
        variant="outline"
        size="sm"
        aria-label={t("复制代码或提示词")}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setFailed(false);
          } catch {
            setFailed(true);
          }
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
        {copied ? t("已复制") : t("复制")}
      </Button>
      <pre>{children}</pre>
      {failed && <p role="status">{t("请选中内容手动复制。")}</p>}
    </div>
  );
}

function docLink(href: string) {
  if (href.startsWith("#") || /^https?:\/\//.test(href)) return href;
  if (href.startsWith("../skills/coflow/"))
    return `${publicBasePath}/agent/coflow/${href.slice("../skills/coflow/".length)}`;
  if (href === "openapi.yaml") return `${publicBasePath}/agent/openapi.yaml`;
  const resolved = new URL(href, `${repositoryURL}/blob/main/docs/`);
  return resolved.href;
}

type SkillFile = { name: string; content: string };
const skillLabels = [
  "入口与协作规则",
  "安装与身份",
  "Timeline 上报",
  "Todo 管理",
];

function SkillShowcase({ files }: { files: SkillFile[] }) {
  const { t } = useI18n();
  const [selected, setSelected] = useState(0);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState(false);
  const file = files[selected];
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2500);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <section
      id="coflow-skill"
      className="docs-skill"
      aria-labelledby="docs-skill-title"
    >
      <div className="docs-skill-heading">
        <h2 id="docs-skill-title">CoFlow Skill</h2>
        <span>v{coflowSkillVersion}</span>
      </div>
      <p>
        {t(
          "让 Agent 理解 CoFlow 的协作规则，在授权范围内读取上下文、推进任务，并把进展与交付同步到 Timeline。",
        )}
      </p>
      <ul className="docs-skill-capabilities">
        <li>
          <strong>{t("维护任务")}</strong>
          <span>{t("复用或创建任务，更新负责人、阶段与交付记录。")}</span>
        </li>
        <li>
          <strong>{t("同步进展")}</strong>
          <span>{t("说明正在做什么、成果与阻塞，关联持续工作。")}</span>
        </li>
        <li>
          <strong>{t("协同推进")}</strong>
          <span>
            {t("读取反馈，主动提出协作和验收需求，跟进有意义的变化。")}
          </span>
        </li>
      </ul>
      <p className="docs-skill-note">
        {t(
          "一个 Skill，四份文件。以下展示本实例随构建提供的完整内容；更新时需同步入口与全部参考文件。",
        )}
      </p>
      <p className="docs-skill-note">
        {t(
          "安装 Skill 不会自动获得权限或启动其他 Agent。主动协作与任务补齐需使用支持这些规则的版本，线上以实际安装副本为准。",
        )}
      </p>
      <div className="docs-skill-actions">
        <Button size="sm" asChild>
          <Link href={publicDemo ? "#2-首次接入" : "/credentials"}>
            {t("接入 CoFlow Skill")}
          </Link>
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(
                new URL(
                  `${publicBasePath}/agent/coflow/SKILL.md`,
                  window.location.href,
                ).href,
              );
              setCopied(true);
              setError(false);
            } catch {
              setError(true);
            }
          }}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
          {copied ? t("已复制") : t("复制 Skill 链接")}
        </Button>
      </div>
      {publicDemo && (
        <p className="docs-skill-note">
          {t("演示站仅供阅读；请在自己的 CoFlow 实例创建凭证并安装。")}
        </p>
      )}
      {error && <p role="status">{t("请选中内容手动复制。")}</p>}
      <div
        className="docs-skill-tabs"
        role="tablist"
        aria-label={t("Skill 文件")}
      >
        {files.map((item, index) => (
          <button
            key={item.name}
            type="button"
            role="tab"
            id={`skill-tab-${index}`}
            aria-selected={selected === index}
            aria-controls="skill-file-panel"
            tabIndex={selected === index ? 0 : -1}
            onClick={() => setSelected(index)}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % files.length
                  : event.key === "ArrowLeft"
                    ? (index + files.length - 1) % files.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? files.length - 1
                        : null;
              if (next === null) return;
              event.preventDefault();
              setSelected(next);
              document.getElementById(`skill-tab-${next}`)?.focus();
            }}
          >
            {t(skillLabels[index])}
          </button>
        ))}
      </div>
      <div
        id="skill-file-panel"
        role="tabpanel"
        aria-labelledby={`skill-tab-${selected}`}
        tabIndex={0}
      >
        <div className="docs-skill-file">
          <code>{file.name}</code>
          <a href={`${publicBasePath}/agent/coflow/${file.name}`} download>
            <Download size={14} />
            {t("下载文件")}
          </a>
        </div>
        <CodeBlock key={file.name}>
          <code>{file.content}</code>
        </CodeBlock>
      </div>
    </section>
  );
}

export function CollaborationDocs({
  markdown,
  skillFiles,
}: {
  markdown: string;
  skillFiles: SkillFile[];
}) {
  const { t } = useI18n();
  // Content stays in the repository guide. Only interface labels are localized.
  const content = markdown
    .replace(/^# .*\n/, "")
    .replace(/^快速导航：.*\n/m, "");
  let fenced = false;
  const headings = content.split("\n").flatMap((line) => {
    if (line.startsWith("```")) fenced = !fenced;
    const match = !fenced && line.match(/^## (.+)$/);
    return match ? [{ title: match[1], id: anchor(match[1]) }] : [];
  });
  const toc = (
    <nav aria-label={t("本页目录")}>
      <a href="#coflow-skill">CoFlow Skill</a>
      {headings.map((heading) => (
        <a key={heading.id} href={`#${heading.id}`}>
          {heading.title}
        </a>
      ))}
    </nav>
  );
  return (
    <div className="collaboration-docs">
      <header className="docs-header">
        <Link href="/" className="docs-brand">
          <CoFlowLogo />
          <strong>CoFlow</strong>
          <span>Docs</span>
        </Link>
        <Button variant="outline" size="sm" asChild>
          <Link href="/todo">
            <ArrowLeft size={14} />
            {t("返回工作空间")}
          </Link>
        </Button>
      </header>
      <div className="docs-layout">
        <aside className="docs-toc">
          <p>{t("本页目录")}</p>
          {toc}
        </aside>
        <main className="docs-article">
          <div className="docs-intro">
            <span>{t("中文指南")}</span>
            <h1>{t("协作指南")}</h1>
            <p>{t("人与 Agent 共同交付：理念、接入与工作手册。")}</p>
          </div>
          <details className="docs-mobile-toc">
            <summary>{t("本页目录")}</summary>
            {toc}
          </details>
          <article lang="zh-CN">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                h2: ({ children }) => (
                  <h2 id={anchor(plainText(children))}>{children}</h2>
                ),
                h3: ({ children }) => (
                  <h3 id={anchor(plainText(children))}>{children}</h3>
                ),
                pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
                a: ({ href = "", children }) => (
                  <a
                    href={docLink(href)}
                    {...(!href.startsWith("#")
                      ? { target: "_blank", rel: "noopener noreferrer" }
                      : {})}
                  >
                    {children}
                  </a>
                ),
                table: ({ children }) => (
                  <div className="docs-table">
                    <table>{children}</table>
                  </div>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
          <SkillShowcase files={skillFiles} />
          <footer>
            <a
              href={`${repositoryURL}/blob/main/docs/COLLABORATION_GUIDE.md`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {t("在 GitHub 查看源文档")}
            </a>
          </footer>
        </main>
      </div>
    </div>
  );
}
