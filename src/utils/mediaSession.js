// R17:给 modal 内媒体元素绑定系统媒体键(MediaSession API)。
// 接入蓝牙耳机 / 锁屏 / 系统媒体键:play、pause、previoustrack、nexttrack,并同步 playbackState。
// 仅 video/audio 调用;无 navigator.mediaSession 的环境静默跳过(返回 noop cleanup)。
// 返回 cleanup:移除监听 + 清空 actionHandler + playbackState='none'(避免关 modal/切走后仍被耳机控制)。
//
// @param el     HTMLMediaElement(video/audio)
// @param file   SmartFile(取 name 作 metadata.title;artwork 缺省省略,避免缩略图 IO)
// @param nav    { onPrev, onNext } 翻页回调(接 modal.prev/next);缺省则不注册对应 handler
// @returns () => void  解绑函数
export function ensureMediaSession(el, file, { onPrev, onNext } = {}) {
  if (!el || typeof navigator === 'undefined' || !('mediaSession' in navigator))
    return () => {};
  const ms = navigator.mediaSession;
  try {
    ms.metadata = new MediaMetadata({ title: file?.name || '媒体', artist: '相册浏览器' });
  }
  catch {
    // MediaMetadata 不可用(极旧环境)→ 跳过 metadata,actionHandler 仍可注册
  }
  const play = () => {
    el.play()?.catch?.(() => {});
  };
  const pause = () => el.pause();
  try {
    ms.setActionHandler('play', play);
    ms.setActionHandler('pause', pause);
    if (onPrev)
      ms.setActionHandler('previoustrack', () => onPrev());
    if (onNext)
      ms.setActionHandler('nexttrack', () => onNext());
  }
  catch {
    // setActionHandler 不支持(受限环境)→ 跳过
  }
  // 同步播放状态:监听元素的 play/pause 事件驱动 playbackState。
  const onPlay = () => {
    ms.playbackState = 'playing';
  };
  const onPause = () => {
    ms.playbackState = 'paused';
  };
  el.addEventListener('play', onPlay);
  el.addEventListener('pause', onPause);
  ms.playbackState = el.paused ? 'paused' : 'playing';
  return function cleanup() {
    el.removeEventListener('play', onPlay);
    el.removeEventListener('pause', onPause);
    try {
      ms.setActionHandler('play', null);
      ms.setActionHandler('pause', null);
      ms.setActionHandler('previoustrack', null);
      ms.setActionHandler('nexttrack', null);
    }
    catch {}
    ms.playbackState = 'none';
  };
}
