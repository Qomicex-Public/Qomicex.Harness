# Qomicex Harness 品牌资产

本目录由 [`scripts/build-brand-assets.ps1`](../scripts/build-brand-assets.ps1) 生成。

## 目录结构

```
brand/
├─ source/
│   ├─ qomicex-mark.svg          竖版原始文件
│   ├─ qomicex-lockup.svg        横版原始文件
│   └─ layers/                   从两个 SVG 中提取的全部内嵌位图（11 个）
├─ candidates/                   每个图层居中的 512×512 对比图（用于人工确认图层）
├─ icon/
│   ├─ icon.png                  1024×1024 主图标
│   ├─ icon-{16,24,32,48,64,128,256,512,1024}.png
│   ├─ icon.ico                  Windows：16/24/32/48/64/128/256（PNG 压缩条目）
│   └─ icon.icns                 macOS：ic11/ic12/ic07/ic13/ic14/ic08/ic09/ic10
├─ mark/                         应用内 mark：20/24/28/32/48/64/96/128/256
├─ lockup/                       横向 logo：1064×256 与原始 2161×520
├─ preview.html                  浏览器里对比查看（深色/浅色底、全部图层、品牌色）
└─ assets.json                   生成记录（选中的 mark 与 lockup、图层清单）
```

## ⚠️ 关于原始文件的重要事实

**两个原始 SVG 不是矢量图。** 它们是 SVG 外壳 + `<image xlink:href="data:img/png;base64,...">` 内嵌位图，共 11 个图层：

| 文件 | viewBox | 内嵌图层数 |
|---|---|---|
| `qomicex-mark.svg` | 614 × 748 | 5 |
| `qomicex-lockup.svg` | 2981 × 748 | 6 |

**直接后果：**

1. **无法无损缩放。** 最大可用像素就是内嵌位图的原始尺寸（mark 主图形 501×625，横版 logo 2161×520）。当前 1024×1024 图标是从 501×625 放大的 —— 在 256px 以上会有可见的柔化。
2. **无法直接改色。** 要换主色只能重新导出。
3. **无法做主题适配。** 浅色/深色主题需要两套资产时，需要两个版本。
4. **原始文件名有误导性** —— 它们是位图容器，不是矢量图。

**建议：** 向设计方索取 **真正的矢量源文件**（AI / Sketch / Figma / 纯 path 的 SVG）。拿到后本目录的图标集可以重新生成为真正无损的版本。在那之前，当前资产**足以支撑开发与内测**，不适合作为正式发布图标。

## 选定的图层

两个源文件各有多个内嵌图层，但**只有一个是完整图形**，其余都是同一图形的残缺导出。判定依据是内容填充率（不透明像素占画布比例）：

| 图层 | 尺寸 | 填充率 | 用途 |
|---|---|---|---|
| **`mark-layer1-501x625.png`** | **501×625** | **71.5%** | **应用图标与应用内 mark（完整）** |
| `mark-layer5-496x540.png` | 496×540 | 41.7% | 残缺，已弃用 |
| **`lockup-layer2-2161x520.png`** | **2161×520** | **30.0%** | **横向 logo（完整）** |
| `lockup-layer1-2853x630.png` | 2853×630 | 14.1% | 残缺，已弃用 |

脚本用 `$MARK_LAYER` 与 `$LOCKUP_LAYER` 两个常量显式指定图层，不再靠启发式挑选。要换图层只改这两个常量并重跑。

可用 `candidates/` 下的 512×512 对比图人工复核。

## 品牌色（从图形实测）

| 取样来源 | 均值 | 说明 |
|---|---|---|
| `mark-layer1`（主 mark） | `#16E0AD` | 主 mark 图形均色 |
| `mark-layer3`（80×75） | `#05C992` | 小图标层，饱和度高 |
| `mark-layer2`（135×420） | `#04CD95` | 竖向条形层 |
| `lockup-layer2`（横版） | `#0EE0A9` | 含留白，偏亮 |

整体落在薄荷绿/青绿区间 **`#04CD95 – #16E0AD`**。

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

- [ ] **真正的矢量源文件**（最高优先，见上）
- [ ] 浅色主题专用版本（若品牌要求）
- [ ] `favicon.svg`（替换 `apps/web/public/favicon.svg`）
- [ ] PWA manifest 图标（192 / 512）
- [ ] 启动加载页视觉
- [ ] 托盘图标（若需要）

已具备：应用图标三件套（`icon/`）、应用内 mark 多尺寸（`mark/`）、横向 logo（`lockup/`）。
