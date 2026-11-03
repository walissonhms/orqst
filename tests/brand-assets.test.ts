import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const assets = [
  {
    name: 'logo',
    title: 'ORQST',
    width: 880,
    height: 270,
    sha256: '563c296a50c64601bb35236912fb4d7a5ab3b71ea272ec54a0a2ddf989781e1d',
  },
  {
    name: 'logo-dark',
    title: 'ORQST',
    width: 880,
    height: 270,
    sha256: '4413d876432dd344cc348ffcb65e702aa874543dab243b6e075be590cb37eb88',
  },
  {
    name: 'mascot',
    title: 'ORQST mascot',
    width: 690,
    height: 590,
    sha256: '4c249a9e4222100bd2821bd63e3341b696a145f9afda2657615e638defac1d34',
  },
];

for (const asset of assets) {
  test(`reviewed ${asset.name} contains only a fixed SVG wrapper and pinned PNG`, async () => {
    const svg = await readFile(`apps/dashboard/public/brand/orqst-${asset.name}.svg`, 'utf8');
    // A full-document allowlist rejects any extra tags, attributes, external URLs or declarations.
    const wrapper = new RegExp(
      `^<svg xmlns="http://www.w3.org/2000/svg" width="${asset.width}" height="${asset.height}" ` +
        `viewBox="0 0 ${asset.width} ${asset.height}"><title>${asset.title}</title>` +
        `<image width="${asset.width}" height="${asset.height}" ` +
        'href="data:image/png;base64,([A-Za-z0-9+/]+={0,2})"/></svg>\\n$',
    );
    const match = wrapper.exec(svg);
    assert.ok(match?.[1], 'Only the reviewed inert wrapper is allowed');
    const png = Buffer.from(match[1], 'base64');
    assert.equal(png.toString('base64'), match[1]);
    assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(png.toString('ascii', 12, 16), 'IHDR');
    assert.equal(png.readUInt32BE(16), asset.width);
    assert.equal(png.readUInt32BE(20), asset.height);
    assert.equal(createHash('sha256').update(png).digest('hex'), asset.sha256);
  });
}
