# VCPTarotCardGen

基于 [`GPTImageGen.js`](GPTImageGen.js) 的塔罗牌生成器。项目核心目标是按「主题 theme」隔离管理整副塔罗牌的提示词、卡牌框示例图、已生成卡牌与历史备份，并优先使用 [`gpt-image-2`](GPTImageGen.js:28) 的图生图能力，让同一主题下的卡牌保持统一牌框和统一视觉语言。

## 当前功能

- 本地 Web 管理界面：[`public/index.html`](public/index.html)
- 零外部依赖 Node.js 服务：[`server.js`](server.js)
- GPT 图像生成/图生图插件：[`GPTImageGen.js`](GPTImageGen.js)
- 默认主题模板：[`templates/default-theme.json`](templates/default-theme.json)
- 主题文件夹隔离：[`tarotcardsthemes/`](tarotcardsthemes/)
- 敏感配置示例：[`config.env.example`](config.env.example)
- 本地私密配置与主题素材已通过 [`.gitignore`](.gitignore) 排除提交

## 快速启动

1. 复制 [`config.env.example`](config.env.example) 为 [`config.env`](config.env)，填写 OpenAI 兼容接口配置。
2. 启动服务：

```bash
npm start
```

3. 打开：

```text
http://localhost:3107
```

## 目录结构

```text
.
├── GPTImageGen.js
├── server.js
├── package.json
├── config.env.example
├── templates/
│   └── default-theme.json
├── public/
│   ├── index.html
│   ├── style.css
│   └── app.js
└── tarotcardsthemes/
    ├── defaulttarotcards/
    └── <theme-id>/
        ├── theme.json
        ├── frame-example.png
        ├── cards/
        └── backup/
```

> [`tarotcardsthemes/`](tarotcardsthemes/) 是运行期数据目录，包含主题、素材和生成结果，默认不提交到 Git。

## Theme 文件夹说明

每个主题是 [`tarotcardsthemes/`](tarotcardsthemes/) 下的一个独立文件夹：

```text
tarotcardsthemes/<theme-id>/
├── theme.json
├── frame-example.png
├── cards/
│   ├── 0-愚人.png
│   ├── 逆位0-愚人.png
│   └── ...
└── backup/
    ├── 0-愚人-2026-07-02T12-00-00-000Z.png
    └── ...
```

- [`theme.json`](templates/default-theme.json) 保存完整提示词结构。
- [`frame-example.png`](templates/default-theme.json) 是该主题的卡牌框示例图。
- [`cards/`](tarotcardsthemes/) 保存当前版本生成卡牌。
- [`backup/`](tarotcardsthemes/) 保存重新生成前自动移动出来的旧图，并带时间戳。

## 提示词结构

实际生成单张卡牌时，系统会把多层提示词组合成「4 合 1」结构，再发送给 [`GPTImageGen.js`](GPTImageGen.js)。

当前组装逻辑位于 [`assemblePrompt()`](server.js:240) 和前端预览逻辑 [`assemblePrompt()`](public/app.js:45)。

完整结构如下：

```text
1. 卡牌框图生图引导词
2. 整套塔罗主题词
3. 塔罗内部形象统一风格词
4. 分辨率控制提示词
5. 单张卡牌独立提示词
6. 负面约束
```

其中「负面约束」是附加约束，不属于核心 4 层，但会一起发送，方便统一限制质量问题。

### 1. 卡牌框图生图引导词

字段位置：

```json
prompts.frameImageGuide
```

用途：告诉模型必须基于主题文件夹下的 [`frame-example.png`](templates/default-theme.json) 做图生图，并尽量保留统一牌框。

适合写：

```text
基于提供的卡牌框示例图进行图生图：必须保留牌框比例、边框厚度、装饰语言、标题区、画面区、底部留白的整体结构；只替换框内主体插画；整体像一套统一出版物中的单张牌。
```

建议：

- 重点强调「保留边框结构」。
- 重点强调「只改变卡牌内部主体」。
- 如果某个主题边框很复杂，可以明确要求保留「角花、纹章、标题框、底部说明区」。
- 当已经有卡牌框示例图时，图生图阶段通常不需要再重复太多分辨率限制。

### 2. 整套塔罗主题词

字段位置：

```json
prompts.theme
```

用途：定义整副牌的大主题。所有卡牌都会带上这部分。

适合写：

```text
赛博哥特塔罗牌，黑紫色霓虹、金属圣像、数据星盘、电子炼金术、神秘宗教仪式感。
```

或：

```text
东方玄幻塔罗牌，云纹、金箔、水墨层次、古代星象、玉石与符箓，庄严而神秘。
```

建议：

- 主题词要稳定，不要每张牌频繁改。
- 尽量包含：时代背景、材质、色彩、文化符号、氛围。
- 这是整套牌的「世界观」。

### 3. 塔罗内部形象统一风格词

字段位置：

```json
prompts.innerStyle
```

用途：控制卡牌内部主体形象的统一画风，可以留空。

适合写：

```text
人物为细长比例，面部庄严平静，服饰具有繁复金线刺绣，构图中心对称，背景带浅景深神秘光晕。
```

或：

```text
所有角色采用半身圣像式构图，低饱和皮肤色，锐利轮廓，细腻线稿，高对比明暗。
```

建议：

- 如果只想控制边框统一，可以留空。
- 如果人物风格飘移明显，再填写这里。
- 这里不要写单张牌含义，应写全套共用的人物、构图、线条、光影、材质规则。

### 4. 分辨率控制提示词

字段位置：

```json
resolution.prompt
```

用途：在提示词文本层面再次提醒模型输出比例和分辨率。

默认有两档：

```text
1k: 512x1024
2k: 1024x2048
```

示例：

```text
竖版塔罗牌构图，输出比例 1:2，建议分辨率 512x1024。
```

注意：

- [`GPTImageGen.js`](GPTImageGen.js) 调用时会同时发送接口层面的 [`size`](GPTImageGen.js:1289) 参数。
- 这就是「双重限制分辨率」：接口参数限制一次，提示词文本再限制一次。
- 如果是基于已有卡牌框示例图进行图生图，通常示例图已经提供了比例参考，分辨率提示可以弱化，但仍保留在主题配置里便于管理。

### 5. 单张卡牌独立提示词

字段位置：

```json
cards["0-愚人"].upright
cards["0-愚人"].reversed
```

用途：描述某一张牌的具体主体、符号、叙事和正逆位差异。

正位示例：

```text
正位愚人：年轻旅人站在悬崖边，手持白玫瑰与行囊，身旁有白色小犬，远处太阳升起，象征自由、开始、信任与冒险。
```

逆位示例：

```text
逆位愚人：旅人步伐失衡，悬崖边风暴逼近，小犬警示，行囊散落，象征鲁莽、迟疑、失控与未准备好的冒险。
```

建议：

- 正位和逆位一定要分开写。
- 正位强调该牌的常规积极或核心象征。
- 逆位强调阻滞、反转、阴影、失衡或课题。
- 不建议在每张卡里重复整套主题词，否则后续统一修改成本高。
- 单卡提示词应专注「这张牌是什么」。

### 6. 负面约束

字段位置：

```json
prompts.negative
```

用途：统一降低常见生成问题。

示例：

```text
避免低清晰度、畸形手指、错误文字、杂乱边框、风格漂移、现代摄影感、水印、签名。
```

建议：

- 写全套通用的质量约束。
- 不要放太多和主题冲突的内容。
- 如果模型经常破坏牌框，可以加入「避免边框变形、避免裁切牌框」。

## 卡牌框示例图

每个主题优先使用自己的 [`frame-example.png`](templates/default-theme.json)。

### 已有卡牌框

如果主题文件夹中已经存在 [`frame-example.png`](templates/default-theme.json)，生成卡牌时会走图生图：

```json
{
  "command": "edit",
  "image": "tarotcardsthemes/<theme-id>/frame-example.png"
}
```

这会调用 [`GPTImageGen.js`](GPTImageGen.js) 中的图生图流程 [`callEditAPI()`](GPTImageGen.js:1012)。

### 没有卡牌框

如果没有卡牌框，可以在界面输入「卡牌框提示词」，先生成一张框图。

卡牌框提示词建议写：

```text
一张竖版塔罗牌卡牌框，黑金色神秘学风格，四角有星象角花，中间留出大面积插画区域，顶部有标题装饰框，底部有小型符文铭牌，中心不要出现具体人物。
```

注意：

- 卡牌框生成是文生图。
- 这里需要同时选择 [`512x1024`](templates/default-theme.json) 或 [`1024x2048`](templates/default-theme.json)。
- 生成成功后会保存为主题下的 [`frame-example.png`](templates/default-theme.json)。

## 重新生成与备份

当某个卡位已经存在图片，再点击「重新生成」时：

1. 当前图片会先移动到主题的 [`backup/`](tarotcardsthemes/) 文件夹。
2. 文件名会追加时间戳。
3. 新图保存到 [`cards/`](tarotcardsthemes/)。
4. 界面会显示最近备份链接，方便预览旧档。

相关逻辑：

- [`backupExisting()`](server.js:252)
- [`generateCard()`](server.js:304)
- [`listBackups()`](server.js:199)

## 默认卡牌清单

当前规范卡位为 79 个：

- 大阿卡纳 22 张
- 小阿卡纳 56 张
- 牌背 1 张

每张普通卡包含：

- 正位：如 [`0-愚人`](templates/default-theme.json)
- 逆位：如 [`逆位0-愚人`](templates/default-theme.json)

牌背只使用正位提示词。

## 开发说明

启动：

```bash
npm start
```

语法检查：

```bash
node --check server.js
node --check public/app.js
```

Git 远端：

```bash
https://github.com/lioensky/VCPTarotCardGen
```

## 后续建议

- 增加卡牌框上传功能。
- 增加主题导入/导出。
- 增加批量生成队列。
- 增加生成失败重试与任务日志。
- 增加对正逆位成套批量预览的筛选。