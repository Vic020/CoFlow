# CLI 打包与发布

CLI 使用仓库根目录 `VERSION`，发布归档由 Cargo 构建。预编译目标为 Linux x64（Ubuntu 24.04 构建环境）和 Apple Silicon macOS。其他平台可尝试从源码安装。

## 从 CI 到 Release

1. 确认目标提交的 main push CI 成功。Rust CI 在两个平台运行格式、测试和 Clippy。版本、标签及 Release 仍按 [版本规则](VERSIONING.md) 单独执行。
2. 在 GitHub Actions 手动运行 **Build CLI release archives**，选择 main，输入已有稳定标签。工作流核对标签、版本、源码路径和精确提交的 CI。两个构建作业分别使用核对后的提交和 `Cargo.lock`。
3. 下载两个 Actions artifact。每个包含一个 `.tar.gz` 和对应的 `.sha256`。在同一目录运行 `shasum -a 256 -c <归档名>.sha256`。解包后的文件为 `coflow` 和许可证。
4. 发布 CLI 附件时，可在手动运行工作流时勾选 **publish**。发布作业会校验两个归档，将四个文件上传到同标签的现有稳定 Release，并回读附件。也可用 `gh release upload` 手动上传，两种方式都保留同名附件的禁止覆盖行为。

构建产物保留七天。核对与构建作业使用只读令牌和公开源码。选用 **publish** 时，仅上传作业获得 Release 写权限。Release 附件、容器镜像、Pages 和私服部署独立执行。

## 安装脚本

在终端运行以下命令，或从仓库根目录运行 `bash scripts/install-cli.sh`。

```sh
curl --disable -fsSL --proto '=https' --proto-redir '=https' https://raw.githubusercontent.com/Vic020/CoFlow/main/scripts/install-cli.sh | bash
```

脚本默认安装最新 Release 至 `~/.coflow/bin/coflow` 并为 Bash、Zsh 或 Fish 配置 PATH。打开新终端后运行 `coflow --version`。使用 `--version vX.Y.Z` 固定版本，`--bin-dir DIRECTORY` 指定目录，或 `--no-path` 跳过 Shell 配置。归档缺失或校验失败时，现有安装保留。

## 本地打包或安装

```sh
cargo install --path apps/cli --locked --root "$HOME/.coflow"
bash scripts/package-cli.sh ./apps/cli/target/dist
```

如果 Release 附有预编译包，从对应版本页面下载、校验并解压，将其中的 `coflow` 放到 PATH 中，运行 `coflow --version` 核对版本。[CLI 使用说明](CLI_PLAN.md)
