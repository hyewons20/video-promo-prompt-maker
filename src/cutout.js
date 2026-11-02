// 참고 이미지 누끼: 이 PC에서 배경 제거 (이미지는 서버에 원본이 아니라 축소본만 보낸다)
const fs = require('fs');
const sharp = require('sharp');
const { removeBackground } = require('@imgly/background-removal-node');

const MAX_SIDE = 1024;

async function makeCutout(filePath) {
  // 회전 정보 반영 + 긴 변 1024px로 축소 후 PNG로 통일
  const input = await sharp(fs.readFileSync(filePath))
    .rotate()
    .resize(MAX_SIDE, MAX_SIDE, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  const blob = await removeBackground(new Blob([input], { type: 'image/png' }));
  const cutout = await sharp(Buffer.from(await blob.arrayBuffer())).trim().png().toBuffer();

  // Claude에는 투명 배경 대신 흰 배경으로 합성해서 보낸다 (투명 부분이 검게 보이는 것 방지)
  const forAi = await sharp(cutout)
    .flatten({ background: '#ffffff' })
    .resize(768, 768, { fit: 'inside', withoutEnlargement: true })
    .png()
    .toBuffer();

  return { cutout, aiBase64: forAi.toString('base64') };
}

module.exports = { makeCutout };
