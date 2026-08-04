// 应用配置中心。搬自源码 js/config.js 的 CONFIG,无外部依赖。
export const CONFIG = {
  DATABASE: {
    // 相册浏览器本地库(五 store:thumbnails/file-meta/user-data 按 md5 三分类;
    // roots 多根句柄 / scans 扫描快照 按 rootId 索引,KV 风格 out-of-line key)
    NAME: 'GalleryDB',
    VERSION: 3, // v3: 加 roots + scans store(收口原 idb-keyval 默认 store)
    STORES: {
      THUMBNAILS: 'thumbnails',
      FILE_META: 'file-meta',
      USER_DATA: 'user-data',
      ROOTS: 'roots',
      SCANS: 'scans',
    },
  },
  PERFORMANCE: {
    // 可视区卡片同时解码的张数。值越大,首屏出图越快但 CPU/内存占用越高;
    // CPU/内存富余可升,吃紧可降。当前 8 为稳妥选择(8 比 12 在内存吃紧时更稳)。
    // ⚠️ 模块级常量:消费方 useThumbnail.js 的 MAX_CONCURRENT 在模块首次 import 时读一次,
    //    改此值需刷新页面才生效,无运行时热改。
    THUMBNAIL_QUEUE_SIZE: 8,
    INTERSECTION_MARGIN: '100px',
    DEBOUNCE_DELAY: 300,
    SCAN_CONCURRENCY: 32, // scan 内 getFile 并发上限(串行→并发,大文件夹秒级)
    SCAN_FOLDER_CONCURRENCY: 8, // 后台子目录遍历并发上限(原串行深度优先)
  },
  UI: {
    MODAL: { MIN_SCALE: 0.1, MAX_SCALE: 10, ZOOM_STEP: 0.1, ZOOM_SENSITIVITY: 0.002 }, // MIN_SCALE: 相对 fit-initial 的最小缩放比例(大图也能缩到适应的 1/10;调小→缩更小)
    SIDEBAR: { DEFAULT_WIDTH: 280, MIN_WIDTH: 200, MAX_WIDTH: 500 },
    TOAST: { DURATION: 3000, DURATION_LONG: 5000, MAX_VISIBLE: 3 },
  },
  DEFAULTS: {
    thumbnailSize: 400,
    columnCount: 5,
    sortField: 'name',
    sortDirection: 'asc',
    scrollZoneEnabled: true,
    scrollSpeed: 2.0,
    sidebarPinned: false,
    sidebarWidth: 280,
    theme: 'ocean',
    cardStyle: 'hover', // 卡片信息显示样式:hover(悬停滑入)/always(常驻叠层)/detail(上图下信息整卡)。可扩展更多。
  },
  CACHE: { OLD_THRESHOLD_DAYS: 20, AUTO_CLEANUP_ENABLED: false },
};
