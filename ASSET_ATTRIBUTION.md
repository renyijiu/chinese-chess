# Asset Attribution and Contribution Policy

## Project assets

除文件旁的来源说明或 [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) 另有标注外，本仓库把项目原创源文件、生成说明和派生运行时资产按根目录 [`LICENSE`](LICENSE) 的 `GPL-3.0-only` 条款分发。

主要资产边界：

| 范围 | 用途 | 来源记录 |
| --- | --- | --- |
| `assets/concepts/`、`assets/background/` | 原创概念与全景源 | 同目录 prompt/source 文件 |
| `assets/models/`、`assets/characters/` | 可编辑模型、导出与验证证据 | README、lock manifest、生成脚本 |
| `assets/audio/`、`public/audio/` | 音频源与网页运行时版本 | 音频 manifest、QA 与校验脚本 |
| `public/models/` | 游戏实际加载的模型 | 角色 manifest 与资产管线 |
| `public/engines/`、`public/basis/` | 第三方运行时 | `THIRD_PARTY_NOTICES.md` 与目录 README |

## Contributing assets

提交资产即表示贡献者确认：

- 自己创作该内容，或拥有按 `GPL-3.0-only` 再分发和修改所需的完整权利；
- 已记录生成工具、输入、人工修改、上游链接、版本、许可证和必要署名；
- 未包含无法公开的个人信息、工作站路径、水印、嵌入密钥或受限制训练素材；
- 同时提交可编辑源、确定性生成步骤、优化产物和相应验证。

不接受来源不明的模型、纹理、字体、声音、权重文件或网页下载素材。AI 辅助生成资产必须保留 prompt、工具/模型标识、人工修改说明和使用边界，由维护者在合并前确认许可兼容性。
