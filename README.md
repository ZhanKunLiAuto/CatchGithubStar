# Research Radar · 研究雷达

每天从 GitHub 和 Hugging Face 各挑出最多 12 个与你研究方向相关的项目。默认关注**自动驾驶、世界模型、端到端驾驶、视觉语言动作模型（VLA）、具身智能和多模态大模型**。网页支持按平台和研究方向筛选、搜索项目并打开原始仓库。

采集器用 Node.js 生成一份 JSON，静态网页直接读取这份快照。部署到 GitHub Pages 后，每天由 GitHub Actions 更新，关闭浏览器也能继续采集。

## 本地运行

需要 Node.js 22 或更高版本。项目使用 Node.js 自带的模块，进入项目目录即可运行。

```sh
npm start
```

打开 [本地研究雷达](http://127.0.0.1:4173/) 阅读随仓库提供的快照。以下命令分别用于联网更新和运行测试。

```sh
npm run update
npm test
```

快照保存在 `public/data/latest.json`。如果只需要脚本，可以直接读取这个文件。如果只需要网页，把整个 `public/` 目录放到静态托管服务即可。

## 开启每日更新

1. 将包含 `.github/workflows/daily.yml` 的完整项目推到 GitHub 仓库的默认分支。
2. 进入 **Settings → Pages → Build and deployment**，将 **Source** 设为 **GitHub Actions**。
3. 在 **Actions** 页面启用工作流，选择 **Daily research radar → Run workflow**，保持默认分支并运行。部署成功后，在该次运行的 **deploy** 作业或仓库的 **Settings → Pages** 中打开网页。

此后每天北京时间 **07:17** 触发（前一日 UTC 23:17）。GitHub 繁忙时可能延迟。修改工作流中的 `cron` 可以调整时间。定时工作流从默认分支运行，公共仓库连续 60 天无活动时，GitHub 可能暂停它，届时可在 **Actions** 中重新启用。[GitHub 定时触发说明](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)

工作流使用 GitHub 自动提供的 `GITHUB_TOKEN`，每次只把快照文件提交到默认分支，方便下一次计算增长，也可以在 Git 历史中查阅往期结果。仓库规则须允许更新作业向默认分支写入。如果推送时恰逢其他提交，工作流会停止，可在 **Run workflow** 中从最新分支重跑。GitHub Pages 由单独的部署作业发布。[GitHub Pages 自定义工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)

公共数据支持匿名采集。本地频繁抓取时，可以设置环境变量 `GITHUB_TOKEN` 或 `HF_TOKEN` 使用对应平台的认证配额。如果希望定时任务使用 Hugging Face 令牌，可在 **Settings → Secrets and variables → Actions** 添加名为 `HF_TOKEN` 的只读凭据。

## 项目如何入选

| 来源 | 候选范围 | 用来排序的信号 |
| --- | --- | --- |
| GitHub | 对每个方向分别搜索最近 60 天有推送、最近 30 天新建的公开仓库。两组各取总星数靠前的 40 个，排除 fork 和已归档仓库，再合并去重。 | 主题匹配、更新时间、累计星数和可观测的星数增长。 |
| Hugging Face | 分别搜索模型、数据集和 Spaces。每类检索全站趋势前 50 名、各关键词的趋势前 25 名。每个方向的首个关键词还会补查点赞数前 25 名，覆盖近期趋势排名靠后的受关注项目。 | 主题匹配、更新时间、Hub 趋势分、点赞数，以及模型和数据集近 30 天下载量。 |

项目名（`owner/project` 中的 `project` 部分）、描述或标签须命中至少一个研究关键词。GitHub 项目至少要有 1 颗星。Hugging Face 项目只要获得至少 1 个赞、趋势分大于 0，或近 30 天下载量达到 20 次，即可入围。Spaces 使用点赞数和趋势分判断。

在每个平台的 12 个名额内，优先覆盖有合格项目的方向，每个方向选 1 项，并为最近 14 天创建的项目预留最多 2 个名额。其余位置按综合得分填充。项目缺少简介时，采集器会尝试从入选项目的原始 README 提取简介。榜单反映指定候选范围内的阅读优先级。[GitHub 仓库搜索](https://docs.github.com/en/rest/search/search#search-repositories) · [Hugging Face Hub API](https://huggingface.co/docs/hub/en/api)

快照记录所有符合入围条件的 GitHub 候选仓库的星数。如果一个仓库连续两期都在候选范围内，即使上期未进入前 12 名，本期也能计算它的增长。第一次观察时只有总星数。跨日后计算两次采集的星数之差，按实际间隔天数折算日均增速参与评分。同一北京时间日期重复更新会沿用之前日期的比较基线。

某个平台抓取失败，或部分查询失败且没有得到合格结果时，网页会沿用仍符合研究方向的历史结果，并显示该来源上次成功采集的时间。两个平台都抓取失败时保留原快照，工作流报告失败。

## 调整研究方向

编辑 [config/research.json](config/research.json) 的 `topics` 数组。每个方向有五个字段，下面是一个可加入数组的示例。

```json
{
  "id": "imitation-learning",
  "label": "模仿学习",
  "keywords": ["imitation learning", "behavior cloning", "行为克隆"],
  "githubQuery": "topic:imitation-learning",
  "hfQueries": ["imitation-learning", "behavior-cloning"]
}
```

`id` 是稳定标识，`label` 是网页显示的名称。`githubQuery` 使用 GitHub 仓库搜索语法。`hfQueries` 控制在 Hub 中查找哪些项目，把最具代表性的检索词放在首位，可同时查询该词的趋势榜和点赞榜。`keywords` 决定候选项目是否与该方向相关。用领域术语、代表方法名或精确缩写，可以减少同名项目的干扰。保存后运行 `npm run update`，或推到默认分支后手动触发工作流使改动生效。

## 许可证

研究雷达的代码采用 [MIT 许可证](LICENSE)。收录的上游项目、模型和数据集各自的使用条款可在对应仓库中查看。
