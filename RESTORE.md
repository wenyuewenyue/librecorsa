# WY赛车 V2.0 恢复说明（RESTORE.md）

本分支 `v2.0` 是 WY赛车 V2.0 的**全部文本源码**快照，对应本地 `main` 分支的提交 `b102c85`。

## 版本信息

- 本地版本：V2.0（`src/lib/changelog.ts` 中 `CURRENT_VERSION = "V2.0"`）
- 本地 `main` HEAD：`b102c85`（merge(sync): upstream content pack c351fa8, WY赛车 V2.0）
- 上游：KhazP/librecorsa `c351fa8`（2026-11-04 内容包）
- 合并基底：`ba7ba77`

## 二进制文件不在本分支

赛道/赛车 GLB、音频、图片等二进制文件（共 629 个）**没有**推到本分支。
恢复时从 fork 的 `main` 分支取：

```bash
git checkout main -- <二进制文件路径>
```

这样做是安全的，已经逐个核对过：V2.0 的全部 629 个二进制文件，与上游 `c351fa8`
的 blob 完全一致——本地的定制提交只改文本，不含任何二进制改动，新增的
二进制全部来自上游。

## 不要恢复的文件

以下 6 个文件是上游有、但 V2.0 有意删掉的，恢复时不要把它们加回来：

- `cloudflare/old-site-redirect.html`、`cloudflare/worker.js`
- `cloudflare/www/worker.js`、`cloudflare/www/wrangler.jsonc`
- `wrangler.jsonc`（含上游作者的 Cloudflare 账号信息）
- `src/components/menu/RequestPanel.tsx`（本地有意删除）

## 完整恢复

```bash
git clone https://github.com/wenyuewenyue/librecorsa.git
cd librecorsa
git checkout v2.0          # 文本源码（V2.0）
# 把 main 分支有、v2.0 分支没有的文件（即全部 629 个二进制）取回来：
git diff --name-only --diff-filter=A v2.0 main | xargs git checkout main --
npm install && npm run build
```
