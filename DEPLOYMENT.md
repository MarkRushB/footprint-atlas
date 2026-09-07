# 足迹网页：本地运行与发布前检查

当前只在本地运行，未上传个人坐标。浏览器会请求 Mapbox 底图；底图请求会涉及当前视野的瓦片范围，但本项目不会将个人足迹源上传到 Mapbox。

## 本地运行

配置 `.env.local` 的 `NEXT_PUBLIC_MAPBOX_TOKEN`，运行 `npm run dev -- --port 3000`。

## 数据与性能

- 原始 CSV 不修改；派生数据保留所有 791,220 行（含重复坐标），时间、经纬度、海拔和速度保持源字段精度。其他 CSV 字段不用于显示，但仍在原始文件内。
- `node scripts/pack-footprints.mjs "原始文件.csv" public` 重新生成带来源 SHA-256 的二进制包、无损 gzip 包及 UTC 日期索引。
- 专用 Worker 解压、解析、筛选和生成 MultiPoint GeoJSON；通过 Blob URL 交给 Mapbox Worker，避免在主线程创建和序列化数十万个对象。
- Mapbox 原生 circle 与 heatmap 图层共享一个源，支持 globe。无聚类、抽样或人工连线；热力图表示原始记录密度，不表示停留时长。
- 原生瓦片管理只绘制相关区域。移动/缩放不重新执行应用筛选；首次进入新区域时仍可能构建/加载瓦片，不能理解为从此完全不重绘。
- 日期/海拔/速度变化防抖 180 ms；旧请求响应不能覆盖新筛选。样式与航迹可见性不会重新读取 CSV 或二进制文件。
- 本机单次全量筛选测试不是浏览器帧率测试。发布前仍应测真实移动设备上的缩放、球体旋转、热力图及峰值内存。

## 数据口径

日期边界采用 UTC，开始和结束日均包含；最近 7/30 天相对于最后记录日。
默认疑似航迹：记录海拔 ≥ 2,000 m 且速度字段 ≥ 55 m/s。可禁用速度辅助，变成纯海拔筛选。速度单位按 m/s 解释，需结合原导出应用确认。海拔不是离地高度，识别是启发式的，不是航班确认；不符合条件或缺失字段的点仍归普通足迹。

## 验证

```sh
node scripts/test-tracks.mjs "原始文件.csv"
node scripts/test-worker.mjs
node scripts/test-map-style.mjs
npx tsc --noEmit
npm run build
```

第二项需要本地 3000 端口服务，验证真实 HTTP 数据包、流式解压及 Worker 消息逻辑，不替代浏览器交互测试。

## 发布前必须决定

1. 隐私与访问控制：放入 `public` 的坐标文件可被访客直接下载。仅隐藏界面或开启登录页面不足以保护静态数据；需要同时保护数据资源请求。公开上线前应明确是否允许公开完整足迹。
2. Mapbox 使用公开的 `pk` token，并限制到实际部署域名与本地域名，确认账户额度。不要放入 secret token。
3. 构建产物需包含 `track-meta-v2.json`、`tracks-v2-*.bin(.gz)`、Worker 与引擎文件；沿用当前 Vinext/Cloudflare 部署流程。所有数据处理在浏览器，不占服务器解析内存。
4. `public/_headers` 为 Cloudflare 静态资产提供缓存规则；迁移到其他主机时配置等效规则。二进制文件名含源文件哈希，长期缓存；元数据与 Worker 重新验证。
5. 旧的 `footprints.json`、`tracks.bin`、`track-meta.json` 已不参与页面加载，但为保留历史未删除。发布时可排除这些旧文件，避免额外公开历史地点信息。

样式偏好只保存到本浏览器 localStorage，日期筛选不会永久隐藏数据。
