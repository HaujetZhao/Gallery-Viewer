// EXIF 读取(exif-js 回调式 → Promise)。getData 回调里 this 指向 file,必须用 function 不能用箭头。
import EXIF from 'exif-js';

export function extractExif(fileObj) {
  return new Promise((resolve) => {
    if (!fileObj || !EXIF) {
      resolve(null);
      return;
    }
    EXIF.getData(fileObj, function () {
      // 注意:this 指向 fileObj(被 EXIF 标记的对象),不能用箭头函数
      resolve(EXIF.getAllTags(this));
    });
  });
}
