# CLI 打包与发布

CLI 使用仓库根目录 `VERSION`，发布归档由 Cargo 构建。预编译目标为 Linux x64（Ubuntu 24.04 构建环境）和 Apple Silicon macOS。其他平台可尝试从源码安装。

## 从 CI 到 Release

1. 确认目标提交的 main push CI 成功。Rust CI 在两个平台运行格式、测试和 Clippy。版本、标签及 Release 仍按 [版本规则](VERSIONING.md) 单独执行。
2. 在 GitHub Actions 手动运行 **Build CLI release archives**，选择 main，输入已有稳定标签。工作流核对标签、版本、源码路径和精确提交的 CI。两个构建作业分别使用核对后的提交和 `Cargo.lock`。
3. 下载两个 Actions artifact。每个包含一个 `.tar.gz` 和对应的 `.sha256`。在同一目录运行 `shasum -a 256 -c <归档名>.sha256`。解包后的文件为 `coflow` 和许可证。
4. 当本次已授权发布 CLI 附件时，将四个文件上传到同标签的现有 Release。用 `gh release view <标签> --json assets` 回读文件名及状态。发布已存在的同名附件时先核对其内容，上传命令保留默认的禁止覆盖行为。

工作流仅生成 Actions artifact，保留七天。其令牌只读，用于核对源码和 CI，构建作业使用公开代码及公共 Rust 依赖。Release 附件、容器镜像、Pages 和私服部署独立执行。

## 安装脚本

从 CoFlow 的 CLI 下载页保存脚本，或者在仓库根目录运行 `bash scripts/install-cli.sh`。脚本默认安装最新 Release 至 `~/.coflow/bin/coflow`。可用 `--version vX.Y.Z` 固定版本，或用 `--bin-dir DIRECTORY` 指定目录。归档缺失或校验失败时，现有安装保留。脚本会提示如何把目录加到 PATH。

## 本地打包或安装

```sh
cargo install --path apps/cli --locked --root "$HOME/.coflow"
bash scripts/package-cli.sh ./apps/cli/target/dist
```

如果 Release 附有预编译包，从对应版本页面下载、校验并解压，将其中的 `coflow` 放到 PATH 中，运行 `coflow --version` 核对版本。[CLI 使用说明](CLI_PLAN.md)
