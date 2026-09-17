# Qomicex Harness 品牌资产

本目录由 [`scripts/build-brand-assets.ps1`](../scripts/build-brand-assets.ps1) 生成。

## 目录结构

```
brand/
├─ source/
│   ├─ qomicex-mark.svg          竖版原始文件（从 logo.svg 改名而来）
│   ├─ qomicex-lockup.svg        横版原始文件（从「拟物logo+平面文字.svg」改名而来）
│   └─ layers/                   从两个 SVG 中提取的全部内嵌位图（11 个）
├─ candidates/                   每个图层居中的 512×512 对比图（用于人工确认 mark）
├─ icon/
│   ├─ icon.png                  1024×1024 主图标
│   ├─ icon-{16,24,32,48,64,128,256,512,1024}.png
│   ├─ icon.ico                  Windows：16/24/32/48/64/128/256（PNG 压缩条目）
│   └─ icon.icns                 macOS：ic11/ic12/ic07/ic13/ic14/ic08/ic09/ic10
├─ preview.html                  浏览器里对比查看（深色/浅色底、全部图层、品牌色）
└─ assets.json                   生成记录（选中的 mark、图层清单）
```

## ⚠️ 关于原始文件的重要事实

**两个原始 SVG 不是矢量图。** 它们是 SVG 外壳 + `<image xlink:href="data:img/png;base64,...">` 内嵌位图，共 11 个图层：

| 文件 | viewBox | 内嵌图层数 |
|---|---|---|
| `qomicex-mark.svg` | 614 × 748 | 5 |
| `qomicex-lockup.svg` | 2981 × 748 | 6 |

**直接后果：**

1. **无法无损缩放。** 最大可用像素就是内嵌位图的原始尺寸（mark 主图形 496×540，横版组合标 2853×630）。当前 1024×1024 图标是从 496×540 放大的 —— 在 256px 以上会有可见的柔化。
2. **无法直接改色。** 要换主色只能重新导出。
3. **无法做主题适配。** 浅色/深色主题需要两套资产时，需要两个版本。
4. **`logo.svg` 的文件名有误导性** —— 它其实是位图容器，不是矢量 logo。

**建议：** 向设计方索取 **真正的矢量源文件**（AI / Sketch / Figma / 纯 path 的 SVG）。拿到后本目录的图标集可以重新生成为真正无损的版本。在那之前，当前资产**足以支撑开发与内测**，不适合作为正式发布图标。

## 选中的 mark

图标集使用 `mark-layer5-496x540.png`，挑选规则是：**在 mark 与 lockup 两个文件里像素完全一致、宽高比最接近 1（0.8–1.25）、面积最大的共享图层**。

4 个共享图层（两个文件里是同一图形）：

| 图层 | 尺寸 | 宽高比 | 判断 |
|---|---|---|---|
| `*-layer?` 135×420 | 135×420 | 0.32 | 竖长条，疑似文字或装饰 |
| `*-layer?` 80×75 | 80×75 | 1.07 | 近方形但极小，疑似图标细节 |
| `*-layer?` 352×151 | 352×151 | 2.33 | 横向，疑似文字 |
| **`*-layer?` 496×540** | **496×540** | **0.92** | **近方形、面积最大 → 选为 mark** |

**请在 `preview.html` 里确认**（或直接看 `candidates/` 下的 512×512 对比图）。如果不是，告诉我用哪个图层，重新生成图标集即可。

## 品牌色（从图形实测）

| 取样来源 | 均值 | 说明 |
|---|---|---|
| `mark-layer5`（主 mark） | `#0ADEAB` | 主 mark 图形均色 |
| `mark-layer3`（80×75） | `#05C992` | 小图标层，饱和度高 |
| `mark-layer2`（135×420） | `#04CD95` | 竖向条形层 |
| `lockup-layer1`（横版） | `#2CE2B4` | 含留白，偏亮 |

整体落在薄荷绿/青绿区间 **`#04CD95 – #0ADEAB`**。

**建议主色：`#0AD8A8`**（深色主题下可提亮到 `#12E0B0`）。

这个色用于替换 dsh 的蓝色品牌色：

| dsh 现有 token | 现值 | 替换为 |
|---|---|---|
| `--dsw-static-deepseek-500` | `rgb(65, 118, 230)` | `rgb(10, 216, 168)` |
| `--dsw-static-deepseek-450`（深色） | `rgb(86, 134, 254)` | `rgb(18, 224, 176)` |
| `--dsw-static-deepseek-400` | `rgb(103, 158, 254)` | 派生（提亮） |
| `--dsw-static-deepseek-600` | `rgb(72, 104, 178)` | 派生（压暗） |

`apps/desktop/renderer/startup.css` 里的强调色 `#4d6bfe` 同步替换为 `#0AD8A8`。

## 重新生成

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-brand-assets.ps1
```
脚本从 `brand/source/` 读取两个原始 SVG（按声明宽度区分竖版/横版）、提取图层、重挑 mark、重出图标集。**注意脚本必须保持纯 ASCII**：Windows PowerShell 5.1 会把无 BOM 的 `.ps1` 按 ANSI 读取，中文字面量会乱码。

## 待补资产

- [ ] 真正的矢量源文件（见上）
- [ ] 浅色主题专用版本（若品牌要求）
- [ ] `favicon.svg`（替换 `apps/web/public/favicon.svg`）
- [ ] `manifest.webmanifest` 图标（192 / 512，PWA）
- [ ] 启动页 / 加载页用图（替换 dsh 的启动文档视觉）
- [ ] 应用内 sidebar brand mark（用于 `ui-brand-qomicex` 包，尺寸约 20×20 与 24×24）
- [ ] 安装包图标（NSIS installer icon）与托盘图标（若需要）
