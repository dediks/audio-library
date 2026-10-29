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

