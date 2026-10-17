import { nativeImage } from 'electron';
/** 64-bit average hash; sufficient to ignore nearly identical periodic captures. */
export function perceptualHash(png) {
    const bitmap = nativeImage.createFromBuffer(png).resize({ width: 8, height: 8 }).toBitmap();
    const luminance = [];
    for (let i = 0; i < bitmap.length; i += 4)
        luminance.push(bitmap[i] * 0.114 + bitmap[i + 1] * 0.587 + bitmap[i + 2] * 0.299);
    const average = luminance.reduce((sum, value) => sum + value, 0) / luminance.length;
    return luminance.map(value => value >= average ? '1' : '0').join('');
}
export function hammingDistance(first, second) {
    return [...first].reduce((sum, bit, index) => sum + Number(bit !== second[index]), 0);
}
