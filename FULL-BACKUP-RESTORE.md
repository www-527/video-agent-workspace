# 全量备份与换机恢复

代码仓库以外的全量快照保存在本仓库的 GitHub Releases 中。下载普通的 Source code ZIP 或只执行 git clone 不会取得素材、配音模型、数据库和私有配置。

## 下载与解密

1. 登录有权访问此私有仓库的 GitHub 账号，打开名称包含“Full workspace backup”的 Release。下载全部 `workspace.part-*.aesgcm`、`backup-manifest.json`、`restore-full-backup.py` 和本说明，放入同一文件夹。不要漏掉任何分卷。
2. 从密码管理器或 U 盘取出单独保存的 `video-agent-backup-20260930.key`。密钥不在 GitHub；丢失后无法解密。
3. 新电脑准备 Windows x64、Python 3.12+、Node.js 22 和 MariaDB 12.2（或兼容的 MySQL 服务）。安装 Python 解密库：`python -m pip install cryptography`。
4. 在备份下载目录执行下列命令，目标目录必须尚不存在。脚本逐卷验证 SHA-256 和 AES-GCM 认证，逐文件验证原始大小和 SHA-256，支持 Windows 长路径：

分卷较多，安装 GitHub CLI 后可一次性下载全部附件，无需逐个点击：

```cmd
gh auth login
gh release download full-backup-20260930 --repo www-527/video-agent-workspace --dir D:\video-agent-backup
cd /d D:\video-agent-backup
```

下载后解密并恢复：

```cmd
python restore-full-backup.py --backup . --key-file "D:\keys\video-agent-backup-20260930.key" --destination "D:\restored-video-agent"
```

如只校验不解压，将 `--destination ...` 换成 `--verify-only`。请为下载分卷和解压后的全部文件预留足够空间，建议至少 80 GB。校验失败时不要启动应用；重新下载损坏分卷后选择新的目标目录重试。

## 恢复数据库和应用

解压后 `workspace/` 是原工作区，`_backup/database.sql` 是数据库导出，`_backup/file-manifest.json` 是逐文件校验清单。数据库导出包含项目、对话、分镜 HTML、素材记录和检查点等业务表。

1. 在新电脑启动数据库服务。请使用空的新实例：导入 SQL 会重建同名业务表，不能指向已有生产数据库。
2. 在 CMD 中导入，`-p` 会提示输入新电脑数据库管理员密码：

```cmd
mysql -u root -p --default-character-set=utf8mb4 < "D:\restored-video-agent\_backup\database.sql"
```

3. 检查 `workspace/ai-video-agent/.env` 和 `.env.local` 中的 `DATABASE_URL`，使其匹配新电脑的数据库地址、端口、账号和密码。其他 AI、图片、搜索和配音 API 配置已经包含在加密快照中。
4. 在 `workspace/ai-video-agent` 执行：

```cmd
npm ci
npm run db:generate
npm run dev
```

5. 浏览器打开 `http://localhost:3000`，检查项目列表、历史对话、素材、预览和已导出视频。备份时主应用数据库含 103 个项目和 994 条消息；应用可能按工作流过滤列表，因此界面数量不一定等于数据库总数。
6. 本地配音所需的 IndexTTS 模型、Python 运行环境以及 FFmpeg 已随工作区保存。使用 `ai-video-agent/local tts/` 内的启动器；新电脑仍需兼容的显卡驱动，必要时重新创建其 Python 虚拟环境。录制/导出需要安装 Edge 或 Chrome；存在旧电脑绝对路径的配置需改为新位置。操作系统、显卡驱动、浏览器用户资料、系统字体和全局软件安装不属于工作区快照。

工作区内的全部普通文件均收录，包括依赖、临时文件、QA 图片、缓存、成片、模型和各内层 Git 元数据。外层 `.git` 活动目录不直接归档，而以 `_backup/outer-repo.bundle` 保存可达 Git 历史。换机后建议从 GitHub 克隆外层仓库，再按需恢复工作文件；内层 Git worktree 中记录的旧绝对路径需要修复后才能用于开发。

## 安全与备份时点

全量快照使用随机 256 位密钥和 AES-256-GCM 分卷加密，分卷编号与备份 ID 作为认证附加数据。密钥必须与 GitHub 账号分别保管。SQL、环境变量和配置的明文只在本机及解密后的目录内出现，不作为 Release 明文附件上传。

这是一次备份时点的快照，不是自动同步。文件在读取期间会校验大小和修改时间，数据库使用事务导出；应用不应在备份期间继续写入。文件快照和数据库导出并非跨系统原子事务，因此换机后仍需验证项目预览和导出。
