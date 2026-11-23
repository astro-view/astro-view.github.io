/**
 * The "look around" camera.
 *
 * The preview renders a WIDER field than the lens actually captures, so you can
 * see what is just outside the frame and compose against it. The camera frame
 * is then drawn as a rectangle inside that wider view.
 *
 * Both views share one optical axis, one roll and one rectilinear projection,
 * so the rectangle is not an approximation: a direction lands inside it exactly
 * when the real lens would capture it.
 *
 * Geometry. For a rectilinear projection the screen offset of a direction is
 * proportional to the tangent of its off-axis angle. So if the overview has
 * half-angles (Ho, Vo) filling a canvas of W x H pixels, the lens' half-angles
 * (Hc, Vc) occupy
 *
 *     frameWidth  = W * tan(Hc) / tan(Ho)
 *     frameHeight = H * tan(Vc) / tan(Vo)
 *
 * centred on the canvas.
 */
import { DEG2RAD, RAD2DEG, clamp } from '../astronomy/constants';
import type { FieldOfView } from './projection';

/** How much wider than the lens the preview tries to be, in tangent space. */
export const DEFAULT_OVERVIEW_MARGIN = 1.6;

/**
 * Widest vertical field the overview will use. A rectilinear projection
 * stretches badly past this, and the corners stop being readable.
 */
const MAX_OVERVIEW_VERTICAL_DEG = 130;

export interface OverviewGeometry {
  /** Field of view of the whole canvas, usable with `projectToFrame`. */
  fov: FieldOfView;
  /** The camera frame rectangle, in CSS pixels, centred on the canvas. */
  frameWidth: number;
  frameHeight: number;
  /** True when the requested margin had to be reduced to stay below the cap. */
  marginClamped: boolean;
  /**
   * True when the lens is wider than the preview itself, so the frame
   * rectangle would have to be clipped. The UI must say so rather than draw a
   * rectangle at the canvas edge, which would wrongly imply that everything
   * visible is inside the frame.
   */
  frameExceedsView: boolean;
}

export function computeOverview(
  lens: FieldOfView,
  canvasWidth: number,
  canvasHeight: number,
  margin: number = DEFAULT_OVERVIEW_MARGIN,
): OverviewGeometry {
  const w = Math.max(1, canvasWidth);
  const h = Math.max(1, canvasHeight);
  const canvasAspect = w / h;

  const tanLensV = Math.tan((lens.vertical / 2) * DEG2RAD);
  const tanLensH = Math.tan((lens.horizontal / 2) * DEG2RAD);

  // Enlarge whichever axis is the binding constraint, so the frame keeps the
  // requested margin on all four sides whatever shape the canvas is.
  const wanted = margin * Math.max(tanLensV, tanLensH / canvasAspect);
  const cap = Math.tan((MAX_OVERVIEW_VERTICAL_DEG / 2) * DEG2RAD);
  const tanOverviewV = Math.min(wanted, cap);
  const tanOverviewH = tanOverviewV * canvasAspect;

  return {
    fov: {
      vertical: 2 * Math.atan(tanOverviewV) * RAD2DEG,
      horizontal: 2 * Math.atan(tanOverviewH) * RAD2DEG,
      diagonal: 2 * Math.atan(Math.hypot(tanOverviewH, tanOverviewV)) * RAD2DEG,
      aspect: canvasAspect,
      frameWidthMm: 0,
      frameHeightMm: 0,
    },
    // Clamped so an extreme wide-angle lens cannot report a frame larger than
    // the canvas it is drawn in.
    frameWidth: clamp(w * (tanLensH / tanOverviewH), 2, w),
    frameHeight: clamp(h * (tanLensV / tanOverviewV), 2, h),
    marginClamped: wanted > cap,
    frameExceedsView: tanLensH > tanOverviewH || tanLensV > tanOverviewV,
  };
}
