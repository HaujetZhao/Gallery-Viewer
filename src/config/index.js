// 应用配置中心。搬自源码 js/config.js 的 CONFIG + getConfig,无外部依赖。
export const CONFIG = {
  DATABASE: {
    NAME: 'GalleryThumbnailDB',
    VERSION: 1,
    STORES: { THUMBNAILS: 'thumbnails' },
  },
  PERFORMANCE: {
    THUMBNAIL_QUEUE_SIZE: 4,
    INTERSECTION_MARGIN: '100px',
    DEBOUNCE_DELAY: 300,
  },
  UI: {
    MODAL: { MIN_SCALE: 0.1, MAX_SCALE: 10, ZOOM_STEP: 0.1, ZOOM_SENSITIVITY: 0.002 },
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
  },
  CACHE: { OLD_THRESHOLD_DAYS: 20, AUTO_CLEANUP_ENABLED: false },
};

// 点分路径访问器,例:getConfig('UI.MODAL.MIN_SCALE')
export function getConfig(path) {
  const keys = path.split('.');
  let value = CONFIG;
  for (const key of keys) {
    value = value[key];
    if (value === undefined) {
      console.warn(`配置项不存在: ${path}`);
      return undefined;
    }
  }
  return value;
}
