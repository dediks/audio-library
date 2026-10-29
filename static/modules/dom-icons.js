/**
 * Audio Lab - Safe SVG Icon Factory
 * Strict DOM Manipulation (No innerHTML, strictly createElementNS)
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * Helper to create an SVG element with attributes and child shapes without innerHTML.
 * @param {Array<{ tag: string, attrs: Record<string, string> }>} shapes
 * @param {Record<string, string>} rootAttrs
 * @returns {SVGSVGElement}
 */
export function createSvgIcon(shapes, rootAttrs = {}) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '2');
  Object.entries(rootAttrs).forEach(([k, v]) => svg.setAttribute(k, v));

  shapes.forEach(({ tag, attrs }) => {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([k, v]) => el.setAttribute(k, v));
    svg.appendChild(el);
  });
  return svg;
}

/**
 * Creates an icon representing opening in Windows Explorer / external folder.
 * @param {Record<string, string>} rootAttrs
 * @returns {SVGSVGElement}
 */
export function createExplorerIcon(rootAttrs = {}) {
  return createSvgIcon(
    [
      { tag: 'path', attrs: { d: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z' } },
      { tag: 'line', attrs: { x1: '12', y1: '11', x2: '12', y2: '17' } },
      { tag: 'polyline', attrs: { points: '9 14 12 11 15 14' } },
    ],
    { ...rootAttrs, class: (rootAttrs.class ? rootAttrs.class + ' ' : '') + 'icon-svg' }
  );
}

/**
 * Creates an edit/rename pencil icon.
 * @param {Record<string, string>} rootAttrs
 * @returns {SVGSVGElement}
 */
export function createEditIcon(rootAttrs = {}) {
  return createSvgIcon(
    [
      { tag: 'path', attrs: { d: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7' } },
      { tag: 'path', attrs: { d: 'M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z' } },
    ],
    { ...rootAttrs, class: (rootAttrs.class ? rootAttrs.class + ' ' : '') + 'icon-svg' }
  );
}

/**
 * Creates a delete/trash bin icon.
 * @param {Record<string, string>} rootAttrs
 * @returns {SVGSVGElement}
 */
export function createTrashIcon(rootAttrs = {}) {
  return createSvgIcon(
    [
      { tag: 'polyline', attrs: { points: '3 6 5 6 21 6' } },
      { tag: 'path', attrs: { d: 'M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2' } },
      { tag: 'line', attrs: { x1: '10', y1: '11', x2: '10', y2: '17' } },
      { tag: 'line', attrs: { x1: '14', y1: '11', x2: '14', y2: '17' } },
    ],
    { ...rootAttrs, class: (rootAttrs.class ? rootAttrs.class + ' ' : '') + 'icon-svg' }
  );
}


