# 字符视频背景 / ASCII video background

一个持久化的 DSH Web UI 插件：把视频实时转换成字符画，作为整个工作区的背景。视频由浏览器本地解码，逐帧采样成低分辨率字符网格，再用 WebGL 实例化渲染字形图集。

安装后默认播放仓库内置的 `assets/whale-loop.mp4`；也可以随时换成自己的视频。

## 安装

仓库地址：<https://github.com/lixinpeng139/dsh-ascii-video-background>

在 DSH 插件管理器中把该仓库作为 bundle 安装，或克隆后把 `dsh-ascii-video-background` 文件夹作为本地 bundle 添加。首次安装会自动启用内置的鲸鱼循环视频，不需要先上传。

## 使用

1. 打开 **设置 → 字符视频背景**。
2. 默认视频已经在列表里并作为背景播放。
3. 点 **添加视频**，或把视频拖进视频卡片，即可替换为自己的视频。
4. 在同一页调整字符大小、不透明度、配色、画面适配和渲染帧率。

支持浏览器能解码的格式；Chromium/Electron 上通常为 MP4（H.264/AAC）、WebM、OGG。MOV、MKV 是否可播取决于系统解码器。

## 实现

- **Host 半**：注册同源路由：
  - `POST /api/ascii-video-background/upload`：把请求体流式写入 `ctx.attachments.saveFileStream`，单文件上限 512 MB。
  - `GET|HEAD /api/ascii-video-background/media?media=<ref>&token=<token>`：按字节范围读取用户上传的视频。
  - `GET|HEAD /api/ascii-video-background/default`：按字节范围读取仓库内置的默认视频（公开示例素材，不需要令牌）。
  - 上传、用户媒体与状态路由要求页面启动时注入的随机进程令牌；没有令牌的请求返回 403。
- **Client 半**：注册 `shell.overlay` 背景层与 `settings.section` 设置页。视频在页面内解码，字符网格通过 WebGL 实例化绘制；不可用 WebGL 时退回 Canvas 2D `ImageData` 合成。
- **持久化**：用户上传的视频本体是 Harness 附件存储中的内容寻址对象；文件名、附件引用和展示偏好保存在浏览器 `localStorage`。默认视频直接来自插件包，不占用附件存储。

## 渲染算法

字符渲染参考 [Kuimuzion/ASCII-Video](https://github.com/Kuimuzion/ASCII-Video)（GPL-3.0）的 C 实现：

- 内嵌 DejaVu Sans Mono 16×32 位图，覆盖 95 个可打印 ASCII 字符；
- 按实际墨量稳定排序，用亮度曲线查表；壁纸模式把曲线提高到 `gamma = 1.6`，让近黑区域留空、亮部保持浓密；
- 每格原始颜色做饱和度提升（1.35）和比例增益，避免逐通道截断改变色相；再按亮度轻微压暗，避免暗部噪声透出；
- 字符格宽高比 1:2，按屏幕尺寸生成列/行网格。

浏览器端把“每格像素”换成“每格字符”，并用同一套图集缩放到当前字符大小。

## 文件

- `index.js` — Host 路由。
- `client.js` — 渲染器、背景层、设置页、样式。
- `assets/whale-loop.mp4` — 内置默认视频。
- `locale/*.json` — 插件管理器的显示元数据。
- `icon.svg` — 插件图标。

## 限制

- 视频只在本机处理；不会上传到模型服务。
- 每次重启 Harness 后刷新一次页面，让页面拿到新的进程令牌；旧页面里的令牌会失效，视频上传和播放请求会返回 403。
- 从列表“移除”默认视频只会移除列表记录，不会删除插件包里的 `assets/whale-loop.mp4`；移除上传的视频只删除浏览器引用，附件存储中的内容寻址对象仍保留。
- 背景透明度依赖 DSH 页面结构；如果未来 Harness 的 shell 类名改变，背景仍会显示，但侧栏可能重新变成不透明。
- 首次添加大视频需要等待上传完成；上传期间背景不会切换。

## 许可

GPL-3.0-only。字符位图与渲染参数来自 ASCII-Video（Copyright © 2026 Kuimuzion），详见 `NOTICE.md` 与 `LICENSE`。默认视频 `assets/whale-loop.mp4` 由仓库维护者提供，仅作为插件演示素材。
