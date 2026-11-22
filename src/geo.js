// Map views for the live page: a simple equirectangular projection, so the
// browser can place bubbles by longitude/latitude without a map library.
// The country outlines (public/maps.json) are drawn with the same function
// by scripts/make-maps.js, from Natural Earth data (public domain).

/** Each view: a lon/lat box and the pixel width it is drawn at. */
export const MAP_VIEWS = {
  'middle-east': { label: 'Middle East', west: 24, east: 64, south: 11, north: 41, width: 1000 },
  world: { label: 'World', west: -180, east: 180, south: -56, north: 78, width: 1000 },
};

/** Horizontal squash so shapes look right at the view's middle latitude. */
function scales(v) {
  const k = Math.cos((((v.north + v.south) / 2) * Math.PI) / 180);
  const sx = v.width / (v.east - v.west);
  return { sx, sy: sx / k, height: Math.round(((v.north - v.south) * sx) / k) };
}

export function viewSize(v) {
  return { width: v.width, height: scales(v).height };
}

/** [x, y] in pixels inside the view for a longitude/latitude. */
export function project(v, lon, lat) {
  const { sx, sy } = scales(v);
  return [(lon - v.west) * sx, (v.north - lat) * sy];
}
